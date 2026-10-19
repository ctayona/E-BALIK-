-- 20261022: Income tracking for Smart Tags and the Auction Hall. Run in the Supabase SQL Editor after 20261021.
-- Additive and safe to re-run. Nothing existing is changed except two new columns on smart_tags.
--
-- income_ledger is the single record of money received by the Lost and Found Office:
--   * an auction sale is written when staff record the item as paid and collected (or the guard releases it with the pickup PIN);
--   * a Smart Tag sale is written when staff approve a tag's first registration at the office (that is when the owner pays);
--   * super administrators can add a manual entry (another payment, a refund or a correction). Refunds are negative amounts.
-- Entries are never edited or deleted by the app: a mistake is corrected with a new adjustment entry, so the history stays complete.

BEGIN;

-- The price of a Smart Tag, set per batch when the batch is generated (0 = free). Copied onto every tag so a later price
-- change for new batches never rewrites what earlier buyers paid.
ALTER TABLE public.smart_tags
    ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smart_tags_price_check') THEN
        ALTER TABLE public.smart_tags ADD CONSTRAINT smart_tags_price_check CHECK (price >= 0 AND price <= 100000);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.income_ledger (
    entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(20) NOT NULL CHECK (source IN ('auction', 'smart_tag', 'other')),
    kind VARCHAR(20) NOT NULL DEFAULT 'sale' CHECK (kind IN ('sale', 'refund', 'adjustment')),
    -- What the money is for: the auction id, or the Smart Tag code. NULL only for an "other" entry.
    source_ref VARCHAR(64),
    description VARCHAR(255) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount <> 0 AND amount BETWEEN -1000000 AND 1000000),
    payer_account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    method VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'gcash', 'maya', 'bank', 'other')),
    receipt_no VARCHAR(40),
    notes VARCHAR(500),
    recorded_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT income_sale_is_positive CHECK (kind <> 'sale' OR amount > 0),
    CONSTRAINT income_refund_is_negative CHECK (kind <> 'refund' OR amount < 0)
);

-- One sale per auction and one per Smart Tag, so a retried request or a double click can never count money twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_income_one_sale ON public.income_ledger (source, source_ref) WHERE kind = 'sale' AND source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_income_received_at ON public.income_ledger (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_income_source ON public.income_ledger (source, received_at DESC);

-- Only the backend (service key) reads or writes it.
ALTER TABLE public.income_ledger ENABLE ROW LEVEL SECURITY;

-- Auctions already paid and collected before this migration: record their sales once, dated when they were collected.
INSERT INTO public.income_ledger (source, kind, source_ref, description, amount, payer_account_id, method, notes, received_at)
SELECT 'auction', 'sale', a.auction_id::text, left('Auction: ' || coalesce(a.title, 'item'), 255), a.winning_amount, a.winner_account_id, 'cash',
       'Recorded from an auction collected before income tracking started.', coalesce(a.fulfillment_updated_at, a.ended_at, a.updated_at, now())
FROM public.auctions a
WHERE a.fulfillment_status = 'collected' AND a.winning_amount IS NOT NULL AND a.winning_amount > 0
ON CONFLICT DO NOTHING;

DO $$
BEGIN
    IF to_regclass('public.migration_log') IS NOT NULL THEN
        INSERT INTO public.migration_log (name, note) VALUES ('20261022_income_ledger', 'applied') ON CONFLICT (name) DO NOTHING;
    ELSE
        RAISE NOTICE 'migration_log does not exist yet: run 20261017 first, then re-run this file to record it.';
    END IF;
END $$;

COMMIT;

-- Verify after running:
--   SELECT to_regclass('public.income_ledger');
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'smart_tags' AND column_name IN ('price', 'paid_at');
--   SELECT source, count(*), sum(amount) FROM public.income_ledger GROUP BY source;
--
-- Rollback (only if needed): DROP TABLE public.income_ledger; ALTER TABLE public.smart_tags DROP COLUMN price, DROP COLUMN paid_at;
