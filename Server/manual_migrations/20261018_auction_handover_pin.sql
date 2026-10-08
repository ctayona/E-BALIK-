-- 20261018: Handover PIN for auction winners.
-- Run in the Supabase SQL Editor AFTER 20261017_custody_log_receipts_and_migration_log.sql. Additive and safe to re-run; nothing is deleted.
--
-- A winner who is waiting to collect gets a 6 character PIN, exactly like an approved claim (see 20261012). The guard types or scans it at the
-- release desk, which completes the auction. Administrators can still complete an auction by hand, without a PIN.
--   handover_pin_hash       HMAC of the PIN: how the guard's entry finds the auction (the PIN is never searched in plain text)
--   handover_pin_encrypted  the PIN encrypted with the app key, so the winner can read it again in the Auction Hall
--   handover_pin_issued_at  when it was created

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.auctions') IS NULL THEN
        RAISE EXCEPTION 'The auctions table is missing. Run 20261005_auction_hall.sql first.';
    END IF;
END $$;

ALTER TABLE public.auctions
    ADD COLUMN IF NOT EXISTS handover_pin_hash TEXT,
    ADD COLUMN IF NOT EXISTS handover_pin_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS handover_pin_issued_at TIMESTAMP WITH TIME ZONE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_auctions_handover_pin_hash
    ON public.auctions (handover_pin_hash)
    WHERE handover_pin_hash IS NOT NULL;

DO $$
BEGIN
    IF to_regclass('public.migration_log') IS NOT NULL THEN
        INSERT INTO public.migration_log (name, note) VALUES ('20261018_auction_handover_pin', 'applied') ON CONFLICT (name) DO NOTHING;
    ELSE
        RAISE NOTICE 'migration_log does not exist yet: run 20261017 first, then re-run this file to record it.';
    END IF;
END $$;

COMMIT;

-- Verify after running:
--   SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auctions'
--     AND column_name IN ('handover_pin_hash', 'handover_pin_encrypted', 'handover_pin_issued_at');                  -- 3 rows
--
-- Rollback (only if needed): DROP INDEX IF EXISTS public.uq_auctions_handover_pin_hash;
--   ALTER TABLE public.auctions DROP COLUMN handover_pin_hash, DROP COLUMN handover_pin_encrypted, DROP COLUMN handover_pin_issued_at;
