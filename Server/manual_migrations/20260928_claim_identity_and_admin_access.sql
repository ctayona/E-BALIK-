-- E-Balik claim identity documents and admin access levels
-- Run this entire script manually in the Supabase SQL Editor before deploying
-- the corresponding backend/frontend changes.
-- This script is idempotent for repeated setup on the same project.

BEGIN;

ALTER TABLE public.claims
    ADD COLUMN IF NOT EXISTS proof_image_path TEXT,
    ADD COLUMN IF NOT EXISTS identity_document_path TEXT,
    ADD COLUMN IF NOT EXISTS identity_document_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS identity_document_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS released_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS pickup_deadline TIMESTAMPTZ;

UPDATE public.claims
SET status = 'approved_for_pickup'
WHERE lower(coalesce(status, '')) IN ('approved', 'approved for pickup', 'verified', 'accepted');

UPDATE public.claims
SET status = 'rejected'
WHERE lower(coalesce(status, '')) IN ('declined', 'denied');

UPDATE public.claims
SET status = 'pending'
WHERE lower(coalesce(status, '')) IN ('under_review', 'in_review', 'review');

UPDATE public.claims
SET status = 'pending'
WHERE status IS NULL;

ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS access_level VARCHAR(20) NOT NULL DEFAULT 'user';

-- Preserve existing elevated accounts that were previously represented by user_role.
UPDATE public.user_profiles
SET access_level = CASE
    WHEN lower(coalesce(user_role, '')) = 'super_admin' THEN 'super_admin'
    WHEN lower(coalesce(user_role, '')) = 'admin' THEN 'admin'
    ELSE access_level
END
WHERE lower(coalesce(user_role, '')) IN ('admin', 'super_admin');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_profiles_access_level_check'
          AND conrelid = 'public.user_profiles'::regclass
    ) THEN
        ALTER TABLE public.user_profiles
            ADD CONSTRAINT user_profiles_access_level_check
            CHECK (access_level IN ('user', 'admin', 'super_admin'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_profiles_access_level
    ON public.user_profiles(access_level);

-- ID documents are stored as object paths in this private bucket. The Flask
-- backend uses its service-role key and returns short-lived signed URLs only
-- after authenticated claim/admin checks.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'claim-id-documents',
    'claim-id-documents',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'claim-proof-images',
    'claim-proof-images',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- Only the service-role backend can invoke these functions. The application
-- server validates the requester's current access level before calling them.
CREATE OR REPLACE FUNCTION public.admin_update_claim_status(
    p_claim_id UUID,
    p_status TEXT,
    p_admin_id UUID,
    p_rejection_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    current_claim public.claims%ROWTYPE;
    updated_claim public.claims%ROWTYPE;
    actor_level TEXT;
    found_item public.found_items%ROWTYPE;
    notification_title TEXT;
    notification_message TEXT;
    notification_type TEXT;
    current_status TEXT;
    next_status TEXT := lower(trim(coalesce(p_status, '')));
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    SELECT access_level INTO actor_level
    FROM public.user_profiles
    WHERE account_id = p_admin_id;

    IF coalesce(actor_level, '') NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;

    SELECT * INTO current_claim
    FROM public.claims
    WHERE claim_id = p_claim_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim not found';
    END IF;

    SELECT * INTO found_item
    FROM public.found_items
    WHERE item_id = current_claim.found_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Found item for claim was not found';
    END IF;

    current_status := lower(trim(coalesce(current_claim.status, '')));
    IF current_status IN ('approved', 'verified', 'accepted') THEN
        current_status := 'approved_for_pickup';
    ELSIF current_status = 'under_review' OR current_status = 'in_review' OR current_status = 'review' THEN
        current_status := 'pending';
    END IF;

    IF next_status IN ('approved', 'verified', 'accepted') THEN
        next_status := 'approved_for_pickup';
    ELSIF next_status = 'under_review' OR next_status = 'in_review' OR next_status = 'review' THEN
        next_status := 'pending';
    END IF;

    IF current_status = 'pending' AND next_status NOT IN ('approved_for_pickup', 'rejected') THEN
        RAISE EXCEPTION 'Pending claims can only be approved for pickup or rejected';
    ELSIF current_status = 'approved_for_pickup' AND next_status <> 'collected' THEN
        RAISE EXCEPTION 'Approved claims can only be marked collected';
    ELSIF current_status NOT IN ('pending', 'approved_for_pickup') THEN
        RAISE EXCEPTION 'This claim is already closed';
    END IF;

    IF next_status NOT IN ('approved_for_pickup', 'rejected', 'collected') THEN
        RAISE EXCEPTION 'Unsupported claim status';
    END IF;

    UPDATE public.claims
    SET status = next_status,
        updated_at = now(),
        reviewed_by = CASE WHEN next_status IN ('approved_for_pickup', 'rejected') THEN p_admin_id ELSE reviewed_by END,
        reviewed_at = CASE WHEN next_status IN ('approved_for_pickup', 'rejected') THEN now() ELSE reviewed_at END,
        rejection_reason = CASE WHEN next_status = 'rejected' THEN nullif(trim(p_rejection_reason), '') ELSE rejection_reason END,
        collected_at = CASE WHEN next_status = 'collected' THEN now() ELSE collected_at END,
        released_by = CASE WHEN next_status = 'collected' THEN p_admin_id ELSE released_by END
    WHERE claim_id = p_claim_id
    RETURNING * INTO updated_claim;

    IF next_status = 'collected' THEN
        UPDATE public.found_items
        SET status = 'returned', updated_at = now()
        WHERE item_id = current_claim.found_item_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Found item for claim was not found';
        END IF;
    END IF;

    IF next_status = 'approved_for_pickup' THEN
        notification_title := 'Claim approved for office verification';
        notification_message := format(
            'Your claim for "%s" (%s) is approved for office verification. Visit the Admin Building, Ground Floor, OHSO Office, or Security Office behind the Oval Stadium. Bring your original ID. Call 09478685684 or email ebaliksupport@gmail.com.',
            coalesce(found_item.item_name, 'the found item'), coalesce(found_item.fpost_id, 'the submitted reference')
        );
        notification_type := 'claim_approved';
    ELSIF next_status = 'rejected' THEN
        notification_title := 'Claim rejected';
        notification_message := format(
            'Your claim for "%s" (%s) was rejected after review. Reason: %s',
            coalesce(found_item.item_name, 'the found item'),
            coalesce(found_item.fpost_id, 'the submitted reference'),
            coalesce(nullif(trim(p_rejection_reason), ''), 'Please contact E-Balik support for details.')
        );
        notification_type := 'claim_rejected';
    ELSE
        notification_title := 'Item collection recorded';
        notification_message := format(
            'Your in-person collection of "%s" (%s) has been recorded.',
            coalesce(found_item.item_name, 'the found item'), coalesce(found_item.fpost_id, 'the submitted reference')
        );
        notification_type := 'claim_collected';
    END IF;

    INSERT INTO public.user_notifications (
        user_account_id, title, message, notification_type, is_read, found_item_id,
        missing_report_id, link_label, link_page, created_at
    ) VALUES (
        current_claim.claimant_account_id, notification_title, notification_message,
        notification_type, false, current_claim.found_item_id, NULL, NULL, NULL, now()
    );

    RETURN to_jsonb(updated_claim);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_claim_status(UUID, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_claim_status(UUID, TEXT, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_set_user_access_level(
    p_target_account_id UUID,
    p_access_level TEXT,
    p_actor_account_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    actor_level TEXT;
    target_row public.user_profiles%ROWTYPE;
    updated_row public.user_profiles%ROWTYPE;
    next_level TEXT := lower(trim(coalesce(p_access_level, '')));
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    SELECT access_level INTO actor_level
    FROM public.user_profiles
    WHERE account_id = p_actor_account_id;

    IF coalesce(actor_level, '') <> 'super_admin' THEN
        RAISE EXCEPTION 'Super administrator access required';
    END IF;

    IF p_target_account_id = p_actor_account_id THEN
        RAISE EXCEPTION 'You cannot change your own access level';
    END IF;

    IF next_level NOT IN ('user', 'admin') THEN
        RAISE EXCEPTION 'Only user or admin access can be assigned here';
    END IF;

    SELECT * INTO target_row
    FROM public.user_profiles
    WHERE account_id = p_target_account_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    IF target_row.access_level = 'super_admin' THEN
        RAISE EXCEPTION 'Super administrator access can only be changed manually in the database';
    END IF;

    UPDATE public.user_profiles
    SET access_level = next_level,
        updated_at = now()
    WHERE account_id = p_target_account_id
    RETURNING * INTO updated_row;

    RETURN jsonb_build_object(
        'account_id', updated_row.account_id,
        'email', updated_row.email,
        'access_level', updated_row.access_level,
        'user_role', updated_row.user_role
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_access_level(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_access_level(UUID, TEXT, UUID) TO service_role;

COMMIT;

-- After this migration succeeds, assign the first super administrator manually:
-- UPDATE public.user_profiles
-- SET access_level = 'super_admin', updated_at = now()
-- WHERE lower(email) = lower('YOUR_ADMIN_EMAIL');
--
-- Verify before signing in again:
-- SELECT email, user_role, access_level, is_active
-- FROM public.user_profiles
-- WHERE lower(email) = lower('YOUR_ADMIN_EMAIL');
