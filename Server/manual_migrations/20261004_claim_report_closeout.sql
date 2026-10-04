-- Complete the report lifecycle when an approved claim is physically collected.
-- Apply after 20260930_claim_history_reference_and_superadmin_delete.sql.
-- Safe to rerun.

BEGIN;

CREATE OR REPLACE FUNCTION public.close_reports_after_claim_collection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    competing_claim RECORD;
BEGIN
    IF coalesce(NEW.status, '') <> 'collected' OR coalesce(OLD.status, '') = 'collected' THEN
        RETURN NEW;
    END IF;

    UPDATE public.missing_items AS missing
    SET status = 'returned',
        updated_at = now()
    FROM public.ai_matches AS match
    WHERE match.found_item_id = NEW.found_item_id
      AND match.missing_item_id = missing.item_id
      AND match.status = 'confirmed'
      AND missing.status IN ('missing', 'found', 'open')
      AND coalesce(missing.reporter_account_id, missing.account_id) = NEW.claimant_account_id;

    FOR competing_claim IN
        UPDATE public.claims AS competing
        SET status = 'rejected',
            rejection_reason = 'This item was already released after an in-person claim was completed.',
            reviewed_by = NEW.released_by,
            reviewed_at = now(),
            updated_at = now()
        WHERE competing.found_item_id = NEW.found_item_id
          AND competing.claim_id <> NEW.claim_id
          AND lower(coalesce(competing.status, '')) IN (
              'pending', 'under_review', 'in_review', 'review',
              'approved_for_pickup', 'approved', 'verified', 'accepted'
          )
        RETURNING competing.claimant_account_id
    LOOP
        INSERT INTO public.user_notifications (
            user_account_id, title, message, notification_type, is_read,
            found_item_id, missing_report_id, link_label, link_page, created_at
        ) VALUES (
            competing_claim.claimant_account_id,
            'Found item no longer available',
            'This item was already released after an in-person claim was completed. This claim has been closed.',
            'claim_rejected',
            false,
            NEW.found_item_id,
            NULL,
            NULL,
            NULL,
            now()
        );
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS claims_close_related_reports_after_collection ON public.claims;
CREATE TRIGGER claims_close_related_reports_after_collection
AFTER UPDATE OF status ON public.claims
FOR EACH ROW
EXECUTE FUNCTION public.close_reports_after_claim_collection();

REVOKE ALL ON FUNCTION public.close_reports_after_claim_collection() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_reports_after_claim_collection() TO service_role;

-- Bring previously collected claims into the same resolved-report state.
UPDATE public.missing_items AS missing
SET status = 'returned',
    updated_at = now()
WHERE missing.status IN ('missing', 'found', 'open')
  AND EXISTS (
      SELECT 1
      FROM public.ai_matches AS match
      JOIN public.claims AS claim
        ON claim.found_item_id = match.found_item_id
       AND claim.status = 'collected'
      WHERE match.missing_item_id = missing.item_id
        AND match.status = 'confirmed'
        AND coalesce(missing.reporter_account_id, missing.account_id) = claim.claimant_account_id
  );

WITH collected_claims AS (
    SELECT DISTINCT ON (found_item_id)
        found_item_id, released_by, collected_at
    FROM public.claims
    WHERE status = 'collected'
    ORDER BY found_item_id, collected_at DESC NULLS LAST, claim_id
),
closed_claims AS (
    UPDATE public.claims AS competing
    SET status = 'rejected',
        rejection_reason = 'This item was already released after an in-person claim was completed.',
        reviewed_by = collected_claims.released_by,
        reviewed_at = coalesce(collected_claims.collected_at, now()),
        updated_at = now()
    FROM collected_claims
    WHERE competing.found_item_id = collected_claims.found_item_id
      AND lower(coalesce(competing.status, '')) IN (
          'pending', 'under_review', 'in_review', 'review',
          'approved_for_pickup', 'approved', 'verified', 'accepted'
      )
    RETURNING competing.claimant_account_id, competing.found_item_id
)
INSERT INTO public.user_notifications (
    user_account_id, title, message, notification_type, is_read,
    found_item_id, missing_report_id, link_label, link_page, created_at
)
SELECT
    claimant_account_id,
    'Found item no longer available',
    'This item was already released after an in-person claim was completed. This claim has been closed.',
    'claim_rejected',
    false,
    found_item_id,
    NULL,
    NULL,
    NULL,
    now()
FROM closed_claims;

COMMIT;
