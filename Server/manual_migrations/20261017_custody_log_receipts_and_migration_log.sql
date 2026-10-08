-- 20261017: Migration log, guard receipts, Smart Tag link and the per-item custody log.
-- Run in the Supabase SQL Editor AFTER 20261016_archive_and_bid_steps.sql. Additive and safe to re-run; no rows are deleted.
--
-- 1. migration_log: one row per migration file that has been run, so the System control page can show what is applied and what is missing
--    (Supabase does not record SQL Editor runs). Rows for the older files are filled in from what the database already contains.
-- 2. found_items.received_at / received_by: the guard confirmed they physically received the item the finder handed over.
-- 3. found_items.smart_tag_id: the Smart Tag code of an item the office registered from a tag (its owner is told and can claim it).
-- 4. custody_log: the handover log of every item (turned over, received, claim approved, released, auction steps...), newest facts only;
--    older history is rebuilt from timestamps that already exist (see Server/app/utils/custody_log.py).

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.found_items') IS NULL OR to_regclass('public.user_profiles') IS NULL THEN
        RAISE EXCEPTION 'The found_items or user_profiles table is missing. Run the earlier migrations first.';
    END IF;
END $$;

-- ------------------------------------------------------------------------------------------------ 1. migration log
CREATE TABLE IF NOT EXISTS public.migration_log (
    name VARCHAR(120) PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    note TEXT
);
ALTER TABLE public.migration_log ENABLE ROW LEVEL SECURITY;   -- backend (service role) only

DO $$
DECLARE
    names TEXT[] := ARRAY[
        '20260928_claim_identity_and_admin_access', '20260929_admin_totp_mfa', '20260930_account_verification_review', '20260930_admin_item_management',
        '20260930_claim_history_reference_and_superadmin_delete', '20261003_superadmin_delete_user', '20261004_claim_report_closeout', '20261005_auction_hall',
        '20261005b_auction_awaiting_admin_baseline', '20261006_system_control_verification', '20261007_report_integrity_and_reactions', '20261008_smart_tags',
        '20261009_tag_expiry_and_auction_buyout', '20261010_tag_photo_and_mission_control', '20261011_tag_staff_verification', '20261012_handover_pins_and_auction_timeouts',
        '20261013_guard_role_reminders_and_retention', '20261014_recycle_bin', '20261015_report_lifecycle_and_guard_handover', '20261016_archive_and_bid_steps'
    ];
    top INTEGER := 0;
BEGIN
    -- The files run in order, so the newest change that is present tells how many of them have been applied.
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auctions' AND column_name = 'archived_at') THEN top := 20;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'claims' AND column_name = 'missing_report_id') THEN top := 19;
    ELSIF to_regclass('public.recycle_bin') IS NOT NULL THEN top := 18;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'email_preferences') THEN top := 17;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'claims' AND column_name = 'handover_pin_hash') THEN top := 16;
    ELSE
        RAISE NOTICE 'The newest older migrations are not applied yet, so no older file was recorded. Run them in order, then re-run this file.';
    END IF;
    INSERT INTO public.migration_log (name, note)
    SELECT names[i], 'recorded when the log was created: the database already contained this change'
    FROM generate_series(1, top) AS i
    ON CONFLICT (name) DO NOTHING;
END $$;

-- ------------------------------------------------------------------------------------------------ 2 and 3. receipts and Smart Tag link
ALTER TABLE public.found_items
    ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS received_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS smart_tag_id VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_found_items_awaiting_receipt ON public.found_items (handover_guard_id) WHERE handover_guard_id IS NOT NULL AND received_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_found_items_smart_tag ON public.found_items (smart_tag_id) WHERE smart_tag_id IS NOT NULL;

-- ------------------------------------------------------------------------------------------------ 4. custody log
CREATE TABLE IF NOT EXISTS public.custody_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    found_item_id UUID NOT NULL REFERENCES public.found_items(item_id) ON DELETE CASCADE,
    event VARCHAR(40) NOT NULL,
    actor_account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    actor_label TEXT,
    detail TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_custody_log_item ON public.custody_log (found_item_id, created_at);
ALTER TABLE public.custody_log ENABLE ROW LEVEL SECURITY;   -- backend (service role) only

INSERT INTO public.migration_log (name, note)
VALUES ('20261017_custody_log_receipts_and_migration_log', 'applied')
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- Verify after running:
--   SELECT count(*) FROM public.migration_log;                                                                        -- 21 on a fully migrated database
--   SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'found_items'
--     AND column_name IN ('received_at', 'received_by', 'smart_tag_id');                                              -- 3 rows
--   SELECT to_regclass('public.custody_log');                                                                         -- custody_log
--
-- From now on end every new migration file with:
--   INSERT INTO public.migration_log (name, note) VALUES ('<file name without .sql>', 'applied') ON CONFLICT (name) DO NOTHING;
--
-- Rollback (only if needed): DROP TABLE public.custody_log; DROP TABLE public.migration_log;
--   ALTER TABLE public.found_items DROP COLUMN received_at, DROP COLUMN received_by, DROP COLUMN smart_tag_id;
