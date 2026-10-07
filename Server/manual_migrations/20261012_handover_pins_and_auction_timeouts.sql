-- 20261012: Handover PINs (physical release of claimed items) and automatic auction pickup deadlines.
-- Run in the Supabase SQL Editor AFTER 20261011_tag_staff_verification.sql. Additive and safe to re-run; nothing is deleted.
--
-- 1. claims: when an admin approves a claim the server draws a 6 character Handover PIN. The claimant gets it by email;
--    the guard types it to release the item. Only a keyed hash (for lookup) and an encrypted copy (so the owner can read it
--    again in their account) are stored, never the PIN in plain text.
-- 2. auctions: a winner who has not collected after 48 hours gets a 24-hour final warning; after 72 hours the win is forfeited
--    automatically and the item is ready for Re-Auction.
-- 3. user_profiles: a forfeited win bars the account from bidding for 30 days (`bidding_banned_until`).

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.claims') IS NULL THEN
        RAISE EXCEPTION 'public.claims does not exist. Run the earlier migrations first.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Handover PIN on claims
-- ---------------------------------------------------------------------------
ALTER TABLE public.claims
    ADD COLUMN IF NOT EXISTS handover_pin_hash TEXT,          -- HMAC of the PIN: how the guard's entry finds the claim
    ADD COLUMN IF NOT EXISTS handover_pin_encrypted TEXT,     -- AES-GCM copy, shown only to the claimant in their own account
    ADD COLUMN IF NOT EXISTS handover_pin_issued_at TIMESTAMP WITH TIME ZONE;

-- One live PIN per hash: two approved claims can never share a PIN, so a PIN always points at exactly one claim.
CREATE UNIQUE INDEX IF NOT EXISTS uq_claims_handover_pin_hash
    ON public.claims (handover_pin_hash)
    WHERE handover_pin_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Auction pickup deadlines (only when the Auction Hall tables exist)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.auctions') IS NOT NULL THEN
        ALTER TABLE public.auctions
            ADD COLUMN IF NOT EXISTS pickup_warning_sent_at TIMESTAMP WITH TIME ZONE,   -- the 24-hour final warning was sent
            ADD COLUMN IF NOT EXISTS auto_forfeited_at TIMESTAMP WITH TIME ZONE;        -- forfeited by the scheduler: ready for Re-Auction
        CREATE INDEX IF NOT EXISTS idx_auctions_pickup_deadlines
            ON public.auctions (winner_notified_at)
            WHERE status = 'ended' AND fulfillment_status = 'awaiting_pickup';
    ELSE
        RAISE NOTICE 'public.auctions does not exist yet, so the auction columns were skipped. Re-run this file after the Auction Hall migrations.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Bidding ban on accounts
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS bidding_banned_until TIMESTAMP WITH TIME ZONE,   -- NULL or a past date means the account may bid
    ADD COLUMN IF NOT EXISTS bidding_ban_reason TEXT;

COMMIT;

-- Verify:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'claims'
--    AND column_name IN ('handover_pin_hash','handover_pin_encrypted','handover_pin_issued_at');                  -- 3 rows
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'auctions'
--    AND column_name IN ('pickup_warning_sent_at','auto_forfeited_at');                                           -- 2 rows
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'user_profiles'
--    AND column_name IN ('bidding_banned_until','bidding_ban_reason');                                            -- 2 rows
--
-- Rollback (only if needed):
--   DROP INDEX IF EXISTS public.uq_claims_handover_pin_hash;
--   ALTER TABLE public.claims DROP COLUMN IF EXISTS handover_pin_hash, DROP COLUMN IF EXISTS handover_pin_encrypted, DROP COLUMN IF EXISTS handover_pin_issued_at;
--   DROP INDEX IF EXISTS public.idx_auctions_pickup_deadlines;
--   ALTER TABLE public.auctions DROP COLUMN IF EXISTS pickup_warning_sent_at, DROP COLUMN IF EXISTS auto_forfeited_at;
--   ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS bidding_banned_until, DROP COLUMN IF EXISTS bidding_ban_reason;
