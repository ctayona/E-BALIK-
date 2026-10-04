-- Claim history, readable claim references, and Superadmin claim deletion.
-- Run this as a separate migration in the Supabase SQL Editor before deploying
-- the backend and Admin changes that depend on these objects.
-- Safe to rerun after a successful application.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.claim_reference_seq;

ALTER TABLE public.claims
    ADD COLUMN IF NOT EXISTS claim_reference TEXT;

WITH numbered_claims AS (
    SELECT
        claim.claim_id,
        claim.created_at,
        found.fpost_id,
        row_number() OVER (ORDER BY claim.created_at NULLS LAST, claim.claim_id) AS reference_number
    FROM public.claims AS claim
    LEFT JOIN public.found_items AS found ON found.item_id = claim.found_item_id
    WHERE claim.claim_reference IS NULL OR btrim(claim.claim_reference) = ''
)
UPDATE public.claims AS claim
SET claim_reference = format(
    'CLM-%s-%s-%s',
    to_char(coalesce(numbered.created_at, now()) AT TIME ZONE 'UTC', 'YYYY'),
    lpad(numbered.reference_number::text, 6, '0'),
    coalesce(
        nullif(trim(both '-' FROM regexp_replace(upper(coalesce(numbered.fpost_id, '')), '[^A-Z0-9]+', '-', 'g')), ''),
        'ITEM'
    )
)
FROM numbered_claims AS numbered
WHERE claim.claim_id = numbered.claim_id;

DO $$
DECLARE
    highest_reference_number BIGINT;
BEGIN
    SELECT max((regexp_match(claim_reference, '^CLM-[0-9]{4}-([0-9]+)-'))[1]::BIGINT)
    INTO highest_reference_number
    FROM public.claims;

    IF highest_reference_number IS NULL THEN
        PERFORM setval('public.claim_reference_seq', 1, false);
    ELSE
        PERFORM setval('public.claim_reference_seq', highest_reference_number, true);
    END IF;
END $$;

ALTER TABLE public.claims
    ALTER COLUMN claim_reference SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_claim_reference
    ON public.claims(claim_reference);

CREATE OR REPLACE FUNCTION public.assign_claim_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    found_reference TEXT;
    reference_number BIGINT;
    item_suffix TEXT;
BEGIN
    IF NEW.claim_reference IS NOT NULL AND btrim(NEW.claim_reference) <> '' THEN
        RETURN NEW;
    END IF;

    SELECT fpost_id INTO found_reference
    FROM public.found_items
    WHERE item_id = NEW.found_item_id;

    reference_number := nextval('public.claim_reference_seq');
    item_suffix := coalesce(
        nullif(trim(both '-' FROM regexp_replace(upper(coalesce(found_reference, '')), '[^A-Z0-9]+', '-', 'g')), ''),
        'ITEM'
    );
    NEW.claim_reference := format(
        'CLM-%s-%s-%s',
        to_char(coalesce(NEW.created_at, now()) AT TIME ZONE 'UTC', 'YYYY'),
        lpad(reference_number::text, 6, '0'),
        item_suffix
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS claims_assign_reference_before_insert ON public.claims;
CREATE TRIGGER claims_assign_reference_before_insert
BEFORE INSERT ON public.claims
FOR EACH ROW
EXECUTE FUNCTION public.assign_claim_reference();

CREATE TABLE IF NOT EXISTS public.claim_change_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID NOT NULL,
    claim_reference TEXT NOT NULL,
    found_item_id UUID,
    found_item_reference TEXT,
    actor_account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
    old_values JSONB,
    new_values JSONB,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claim_change_history_changed_at
    ON public.claim_change_history(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_claim_change_history_claim_id
    ON public.claim_change_history(claim_id, changed_at DESC);

INSERT INTO public.claim_change_history (
    claim_id, claim_reference, found_item_id, found_item_reference,
    actor_account_id, action, new_values, changed_at
)
SELECT
    claim.claim_id,
    claim.claim_reference,
    claim.found_item_id,
    found.fpost_id,
    claim.claimant_account_id,
    'created',
    to_jsonb(claim) - ARRAY[
        'claim_reason',
        'proof_image_url',
        'proof_image_path',
        'identity_document_path',
        'identity_document_name'
    ],
    coalesce(claim.created_at, now())
FROM public.claims AS claim
LEFT JOIN public.found_items AS found ON found.item_id = claim.found_item_id
WHERE NOT EXISTS (
    SELECT 1
    FROM public.claim_change_history AS history
    WHERE history.claim_id = claim.claim_id
      AND history.action = 'created'
);

ALTER TABLE public.claim_change_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.claim_change_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.claim_change_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.claim_reference_seq TO service_role;

CREATE OR REPLACE FUNCTION public.capture_claim_change_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    item_reference TEXT;
    actor_id UUID;
    sensitive_columns TEXT[] := ARRAY[
        'claim_reason',
        'proof_image_url',
        'proof_image_path',
        'identity_document_path',
        'identity_document_name'
    ];
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT fpost_id INTO item_reference
        FROM public.found_items
        WHERE item_id = NEW.found_item_id;

        actor_id := coalesce(
            nullif(current_setting('app.claim_actor_account_id', true), '')::UUID,
            NEW.reviewed_by,
            NEW.released_by,
            NEW.claimant_account_id,
            auth.uid()
        );

        INSERT INTO public.claim_change_history (
            claim_id, claim_reference, found_item_id, found_item_reference,
            actor_account_id, action, new_values
        ) VALUES (
            NEW.claim_id, NEW.claim_reference, NEW.found_item_id, item_reference,
            actor_id, 'created', to_jsonb(NEW) - sensitive_columns
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(OLD) - ARRAY['updated_at']::TEXT[])
            IS NOT DISTINCT FROM (to_jsonb(NEW) - ARRAY['updated_at']::TEXT[]) THEN
            RETURN NEW;
        END IF;

        SELECT fpost_id INTO item_reference
        FROM public.found_items
        WHERE item_id = NEW.found_item_id;

        actor_id := coalesce(
            nullif(current_setting('app.claim_actor_account_id', true), '')::UUID,
            CASE WHEN NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by THEN NEW.reviewed_by END,
            CASE WHEN NEW.released_by IS DISTINCT FROM OLD.released_by THEN NEW.released_by END,
            auth.uid()
        );

        INSERT INTO public.claim_change_history (
            claim_id, claim_reference, found_item_id, found_item_reference,
            actor_account_id, action, old_values, new_values
        ) VALUES (
            NEW.claim_id, NEW.claim_reference, NEW.found_item_id, item_reference,
            actor_id, 'updated', to_jsonb(OLD) - sensitive_columns,
            to_jsonb(NEW) - sensitive_columns
        );
        RETURN NEW;
    ELSE
        SELECT fpost_id INTO item_reference
        FROM public.found_items
        WHERE item_id = OLD.found_item_id;

        actor_id := coalesce(
            nullif(current_setting('app.claim_actor_account_id', true), '')::UUID,
            auth.uid(),
            OLD.claimant_account_id
        );

        INSERT INTO public.claim_change_history (
            claim_id, claim_reference, found_item_id, found_item_reference,
            actor_account_id, action, old_values
        ) VALUES (
            OLD.claim_id, OLD.claim_reference, OLD.found_item_id,
            coalesce(item_reference, OLD.found_item_id::TEXT), actor_id,
            'deleted', to_jsonb(OLD) - sensitive_columns
        );
        RETURN OLD;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS claims_capture_change_history ON public.claims;
CREATE TRIGGER claims_capture_change_history
AFTER INSERT OR UPDATE OR DELETE ON public.claims
FOR EACH ROW
EXECUTE FUNCTION public.capture_claim_change_history();

CREATE OR REPLACE FUNCTION public.admin_delete_claim(
    p_claim_id UUID,
    p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    actor_level TEXT;
    claim_row public.claims%ROWTYPE;
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    SELECT access_level INTO actor_level
    FROM public.user_profiles
    WHERE account_id = p_admin_id;

    IF coalesce(actor_level, '') <> 'super_admin' THEN
        RAISE EXCEPTION 'Super administrator access required';
    END IF;

    SELECT * INTO claim_row
    FROM public.claims
    WHERE claim_id = p_claim_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim not found';
    END IF;

    PERFORM set_config('app.claim_actor_account_id', p_admin_id::TEXT, true);

    DELETE FROM public.claims
    WHERE claim_id = p_claim_id;

    RETURN to_jsonb(claim_row);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_claim(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_claim(UUID, UUID) TO service_role;

COMMIT;
