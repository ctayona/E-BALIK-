-- 20261015: Report lifecycle sync and guard handover.
-- Run in the Supabase SQL Editor AFTER 20261014_recycle_bin.sql. Additive and safe to re-run; no rows are deleted.
--
-- 1. claims.missing_report_id: the claimant can say which of their lost reports the claim is for. When the claim is collected, that report
--    (and any report with a confirmed AI match to the item) is closed as returned, and its owner is told.
-- 2. found_items.handover_guard_id: the guard the finder handed the item to (guard_name_or_id keeps the readable name).
-- 3. admin_update_claim_status now lets a guard record a COLLECTION (and nothing else). Before this, a guard who scanned a Handover PIN
--    was refused by the database, so the release desk could not be used by guard accounts.
-- 4. close_reports_after_claim_collection also closes the explicitly linked lost report and sends the owner an in-app notice.
-- 5. admin_set_user_access_level now lets administrators (not only super administrators) make someone a guard or a user again. Making or
--    changing an administrator stays with super administrators; nobody can change themselves or a super administrator.

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.claims') IS NULL OR to_regclass('public.found_items') IS NULL OR to_regclass('public.missing_items') IS NULL THEN
        RAISE EXCEPTION 'The claims, found_items or missing_items table is missing. Run the earlier migrations first.';
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------ 1. which lost report a claim is for
ALTER TABLE public.claims
    ADD COLUMN IF NOT EXISTS missing_report_id UUID REFERENCES public.missing_items(item_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_claims_missing_report ON public.claims (missing_report_id) WHERE missing_report_id IS NOT NULL;

-- ------------------------------------------------------------------------------------------------ 2. which guard received a found item
ALTER TABLE public.found_items
    ADD COLUMN IF NOT EXISTS handover_guard_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_found_items_handover_guard ON public.found_items (handover_guard_id) WHERE handover_guard_id IS NOT NULL;

-- ------------------------------------------------------------------------------------------------ 3. claim status: guards may record a collection
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

    IF coalesce(actor_level, '') NOT IN ('guard', 'admin', 'super_admin') THEN
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

    -- A guard works the release desk only: handing an approved item over. Reviewing claims stays with administrators.
    IF actor_level = 'guard' AND next_status <> 'collected' THEN
        RAISE EXCEPTION 'Administrator access required';
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

-- ------------------------------------------------------------------------------------------------ 4. close the claimant's lost report when the item is collected
CREATE OR REPLACE FUNCTION public.close_reports_after_claim_collection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    competing_claim RECORD;
    closed_report RECORD;
BEGIN
    IF coalesce(NEW.status, '') <> 'collected' OR coalesce(OLD.status, '') = 'collected' THEN
        RETURN NEW;
    END IF;

    -- The claimant's own lost report: the one they named on the claim, or one an administrator confirmed as a match for this item.
    FOR closed_report IN
        UPDATE public.missing_items AS missing
        SET status = 'returned',
            updated_at = now()
        WHERE missing.status IN ('missing', 'found', 'open')
          AND coalesce(missing.reporter_account_id, missing.account_id) = NEW.claimant_account_id
          AND (
              (NEW.missing_report_id IS NOT NULL AND missing.item_id = NEW.missing_report_id)
              OR EXISTS (
                  SELECT 1
                  FROM public.ai_matches AS match
                  WHERE match.found_item_id = NEW.found_item_id
                    AND match.missing_item_id = missing.item_id
                    AND match.status = 'confirmed'
              )
          )
        RETURNING missing.item_id, missing.mpost_id, missing.item_name
    LOOP
        INSERT INTO public.user_notifications (
            user_account_id, title, message, notification_type, is_read,
            found_item_id, missing_report_id, link_label, link_page, created_at
        ) VALUES (
            NEW.claimant_account_id,
            'Your lost report is completed',
            format('Your lost report "%s" (%s) is now completed because the item was released to you.',
                   coalesce(closed_report.item_name, 'your item'), coalesce(closed_report.mpost_id, 'report')),
            'report_completed',
            false,
            NEW.found_item_id,
            closed_report.item_id,
            'View completed reports',
            'my-reports',
            now()
        );
    END LOOP;

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

REVOKE ALL ON FUNCTION public.close_reports_after_claim_collection() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_reports_after_claim_collection() TO service_role;

-- ------------------------------------------------------------------------------------------------ 5. who may assign the guard role
-- Administrators can now make a user a guard and take it away again. Making someone an administrator (or changing one) stays with
-- super administrators, and nobody can change their own level or a super administrator.
CREATE OR REPLACE FUNCTION public.admin_set_user_access_level(p_target_account_id uuid, p_access_level text, p_actor_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

    IF coalesce(actor_level, '') NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;

    IF p_target_account_id = p_actor_account_id THEN
        RAISE EXCEPTION 'You cannot change your own access level';
    END IF;

    IF next_level NOT IN ('user', 'guard', 'admin') THEN
        RAISE EXCEPTION 'Only user, guard or admin access can be assigned here';
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

    IF actor_level = 'admin' AND (next_level = 'admin' OR target_row.access_level = 'admin') THEN
        RAISE EXCEPTION 'Super administrator access required';
    END IF;

    IF next_level <> 'user' AND target_row.is_active IS FALSE THEN
        RAISE EXCEPTION 'This account is suspended. Reactivate it before giving it staff access.';
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
$function$;

REVOKE ALL ON FUNCTION public.admin_set_user_access_level(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_access_level(UUID, TEXT, UUID) TO service_role;

COMMIT;

-- Verify after running:
--   SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'
--     AND ((table_name = 'claims' AND column_name = 'missing_report_id') OR (table_name = 'found_items' AND column_name = 'handover_guard_id'));   -- 2 rows
--   SELECT position('''guard''' in pg_get_functiondef(oid)) > 0 AS guards_allowed FROM pg_proc WHERE proname = 'admin_update_claim_status';           -- true
--
-- Rollback (only if needed; the two columns are harmless to keep):
--   ALTER TABLE public.claims DROP COLUMN IF EXISTS missing_report_id;
--   ALTER TABLE public.found_items DROP COLUMN IF EXISTS handover_guard_id;
--   then re-run 20260928_claim_identity_and_admin_access.sql (claim function), 20261004_claim_report_closeout.sql (trigger function) and the
--   admin_set_user_access_level block of 20261013_guard_role_reminders_and_retention.sql (role function).
