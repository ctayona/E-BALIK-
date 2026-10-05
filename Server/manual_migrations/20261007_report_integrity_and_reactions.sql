-- 20261007: duplicate-claim protection and saved auction reactions (hearts).
-- Run in the Supabase SQL Editor after 20261006_system_control_verification.sql. Additive and safe to re-run.
-- It deletes nothing and rewrites no existing rows.

BEGIN;

-- 1. Saved auction reactions: who hearted which auction. Backend-only access (RLS on, no policies).
CREATE TABLE IF NOT EXISTS public.auction_reactions (
    auction_id UUID NOT NULL REFERENCES public.auctions(auction_id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.user_profiles(account_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (auction_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_auction_reactions_account ON public.auction_reactions(account_id);
ALTER TABLE public.auction_reactions ENABLE ROW LEVEL SECURITY;

-- 2. At most one OPEN claim per person per found item, enforced by the database itself, so a double-click or a
--    retry can never create two records. If duplicates already exist the index is skipped (nothing is deleted):
--    resolve them with the query below, then run this file again.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.claims
         WHERE status IN ('pending', 'approved_for_pickup')
         GROUP BY found_item_id, claimant_account_id HAVING COUNT(*) > 1
    ) THEN
        RAISE NOTICE 'Duplicate open claims already exist, so uq_claims_one_open_per_claimant_item was NOT created. Find them with the query at the bottom of this file, reject or delete the extras in the admin console, then re-run this file.';
    ELSE
        CREATE UNIQUE INDEX IF NOT EXISTS uq_claims_one_open_per_claimant_item
            ON public.claims (found_item_id, claimant_account_id)
            WHERE status IN ('pending', 'approved_for_pickup');
    END IF;
END $$;

COMMIT;

-- Find duplicate open claims (read-only). Keep the earliest of each group and remove the others from the admin console:
-- SELECT found_item_id, claimant_account_id, COUNT(*) AS copies, MIN(created_at) AS first_created,
--        ARRAY_AGG(claim_reference ORDER BY created_at) AS references
--   FROM public.claims
--  WHERE status IN ('pending', 'approved_for_pickup')
--  GROUP BY found_item_id, claimant_account_id HAVING COUNT(*) > 1;
