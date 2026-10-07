-- 20261013: Guard role, email preferences, claim pickup reminders, Smart Tag expiry reminders and evidence retention.
-- Run in the Supabase SQL Editor AFTER 20261012_handover_pins_and_auction_timeouts.sql. Additive and safe to re-run; nothing is deleted.
--
-- 1. user_profiles.access_level may now be 'guard': a release-desk account that can only use the Handover PIN screen.
--    admin_set_user_access_level() is re-created so a super admin can assign it (it was limited to user and admin).
-- 2. user_profiles.email_preferences: the user's choices for optional emails (reminders, announcements). Missing key = on.
-- 3. claims: pickup_reminder_sent_at (one reminder per approved claim) and evidence_purged_at (ID documents and proof photos
--    were deleted after the retention period). The existing pickup_deadline column is now used.
-- 4. smart_tags.expiry_reminder_sent_at: one expiry reminder per validity period (cleared when a tag is renewed).

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.claims') IS NULL OR to_regclass('public.user_profiles') IS NULL THEN
        RAISE EXCEPTION 'claims or user_profiles is missing. Run the earlier migrations first.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Guard role
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_access_level_check;
ALTER TABLE public.user_profiles
    ADD CONSTRAINT user_profiles_access_level_check CHECK (access_level IN ('user', 'guard', 'admin', 'super_admin'));

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

    IF coalesce(actor_level, '') <> 'super_admin' THEN
        RAISE EXCEPTION 'Super administrator access required';
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

-- ---------------------------------------------------------------------------
-- 2. Email preferences
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS email_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;   -- e.g. {"reminders": false}; a missing key means "on"

-- ---------------------------------------------------------------------------
-- 3. Claim pickup reminders and evidence retention
-- ---------------------------------------------------------------------------
ALTER TABLE public.claims
    ADD COLUMN IF NOT EXISTS pickup_reminder_sent_at TIMESTAMP WITH TIME ZONE,   -- the 7 day reminder was sent
    ADD COLUMN IF NOT EXISTS evidence_purged_at TIMESTAMP WITH TIME ZONE;        -- ID document and proof photo were deleted

CREATE INDEX IF NOT EXISTS idx_claims_open_pickups
    ON public.claims (pickup_deadline) WHERE status = 'approved_for_pickup';
CREATE INDEX IF NOT EXISTS idx_claims_evidence_pending
    ON public.claims (updated_at) WHERE status IN ('collected', 'rejected') AND evidence_purged_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Smart Tag expiry reminders (only when the Smart Tags table exists)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.smart_tags') IS NOT NULL THEN
        ALTER TABLE public.smart_tags ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at TIMESTAMP WITH TIME ZONE;
        CREATE INDEX IF NOT EXISTS idx_smart_tags_expiry_reminder
            ON public.smart_tags (valid_until)
            WHERE status IN ('active', 'lost') AND expiry_reminder_sent_at IS NULL;
    ELSE
        RAISE NOTICE 'public.smart_tags does not exist yet, so the reminder column was skipped. Re-run this file after the Smart Tag migrations.';
    END IF;
END $$;

COMMIT;

-- Verify:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'user_profiles_access_level_check';      -- includes 'guard'
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'email_preferences';
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'claims' AND column_name IN ('pickup_reminder_sent_at','evidence_purged_at');   -- 2 rows
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'smart_tags' AND column_name = 'expiry_reminder_sent_at';
--
-- Rollback (only if needed; first change any 'guard' accounts back to 'user'):
--   UPDATE public.user_profiles SET access_level = 'user' WHERE access_level = 'guard';
--   ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_access_level_check;
--   ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_access_level_check CHECK (access_level IN ('user', 'admin', 'super_admin'));
--   (re-run the admin_set_user_access_level definition from 20260928_claim_identity_and_admin_access.sql)
--   DROP INDEX IF EXISTS public.idx_claims_open_pickups, public.idx_claims_evidence_pending, public.idx_smart_tags_expiry_reminder;
--   ALTER TABLE public.claims DROP COLUMN IF EXISTS pickup_reminder_sent_at, DROP COLUMN IF EXISTS evidence_purged_at;
--   ALTER TABLE public.smart_tags DROP COLUMN IF EXISTS expiry_reminder_sent_at;
--   ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS email_preferences;
