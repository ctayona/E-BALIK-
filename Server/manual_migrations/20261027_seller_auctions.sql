-- 20261027: seller auctions. A student or staff member lists their own item, the Lost and Found Office checks it, holds it and runs the
-- auction, the buyer pays the Office, the Office keeps a commission and pays the rest to the seller. Run in the Supabase SQL Editor after
-- 20261026 (the income ledger lock). Additive and safe to re-run.
--   * `auction_submissions`: what a seller asked to list, with the fee terms they accepted and where to send their money (staff only);
--   * `auctions.seller_account_id` / `auctions.submission_id`: an auction that sells someone's own item (NULL = found property, as before);
--   * `income_ledger.kind = 'payout'`: the seller's share of a sale, written together with the sale so income counts the commission only;
--   * `seller_payouts`: what the Office owes each seller, and the payout (method, reference, proof, PO- receipt) once it is sent.
BEGIN;

CREATE TABLE IF NOT EXISTS public.auction_submissions (
    submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_account_id UUID NOT NULL REFERENCES public.user_profiles(account_id) ON DELETE CASCADE,
    title VARCHAR(120) NOT NULL,
    category VARCHAR(60),
    item_condition VARCHAR(20) NOT NULL DEFAULT 'used' CHECK (item_condition IN ('new', 'like_new', 'used', 'worn')),
    description VARCHAR(2000) NOT NULL,
    starting_price NUMERIC(12, 2) NOT NULL CHECK (starting_price >= 50 AND starting_price <= 100000),
    buyout_price NUMERIC(12, 2) CHECK (buyout_price IS NULL OR buyout_price > starting_price),
    duration_days INTEGER NOT NULL DEFAULT 3 CHECK (duration_days BETWEEN 1 AND 14),
    photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    payout_method VARCHAR(10) NOT NULL CHECK (payout_method IN ('cash', 'gcash', 'maya', 'bank')),
    payout_account_name VARCHAR(100),
    payout_account_number VARCHAR(40),
    commission_rate NUMERIC(5, 2) NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 50),
    commission_minimum NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (commission_minimum >= 0),
    commission_cap NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (commission_cap >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'changes_requested', 'listed', 'rejected', 'withdrawn', 'returned')),
    review_note VARCHAR(500),
    reviewed_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    item_received_at TIMESTAMPTZ,
    returned_at TIMESTAMPTZ,
    auction_id UUID,   -- the auction it became (no foreign key: auctions already point here, and a restore must be able to load this table first)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auction_submissions_seller ON public.auction_submissions (seller_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auction_submissions_status ON public.auction_submissions (status, created_at);
ALTER TABLE public.auction_submissions ENABLE ROW LEVEL SECURITY;   -- no policies: only the server (service role) reads or writes it

ALTER TABLE public.auctions ADD COLUMN IF NOT EXISTS seller_account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;
ALTER TABLE public.auctions ADD COLUMN IF NOT EXISTS submission_id UUID REFERENCES public.auction_submissions(submission_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_auctions_seller ON public.auctions (seller_account_id) WHERE seller_account_id IS NOT NULL;

-- The ledger learns one more kind of row. Whatever the original kind check is called, it is replaced by a named one.
DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.income_ledger'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%kind%' AND pg_get_constraintdef(oid) ILIKE '%adjustment%'
    LOOP
        EXECUTE format('ALTER TABLE public.income_ledger DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;
ALTER TABLE public.income_ledger ADD CONSTRAINT income_ledger_kind_check CHECK (kind IN ('sale', 'refund', 'adjustment', 'payout'));
-- One seller share per sale (negative) and at most one cancellation of it (positive, written with a reversal).
CREATE UNIQUE INDEX IF NOT EXISTS uq_income_one_seller_share ON public.income_ledger (source, source_ref) WHERE kind = 'payout' AND amount < 0 AND source_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_income_one_share_cancel ON public.income_ledger (source, source_ref) WHERE kind = 'payout' AND amount > 0 AND source_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.seller_payouts (
    payout_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID UNIQUE REFERENCES public.auctions(auction_id) ON DELETE SET NULL,
    submission_id UUID REFERENCES public.auction_submissions(submission_id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    seller_account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    buyer_account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    sale_entry_id UUID REFERENCES public.income_ledger(entry_id) ON DELETE SET NULL,
    gross NUMERIC(12, 2) NOT NULL CHECK (gross > 0),
    commission_rate NUMERIC(5, 2) NOT NULL,
    commission NUMERIC(12, 2) NOT NULL CHECK (commission >= 0),
    payout_amount NUMERIC(12, 2) NOT NULL CHECK (payout_amount >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'holding' CHECK (status IN ('holding', 'paid', 'cancelled')),
    method VARCHAR(20) CHECK (method IS NULL OR method IN ('cash', 'gcash', 'maya', 'bank')),
    reference VARCHAR(64),
    proof_path VARCHAR(255),
    notes VARCHAR(300),
    receipt_no VARCHAR(40) UNIQUE,
    paid_at TIMESTAMPTZ,
    paid_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    cancelled_reason VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT seller_payout_split CHECK (commission + payout_amount = gross),
    CONSTRAINT seller_payout_paid_has_receipt CHECK (status <> 'paid' OR (receipt_no IS NOT NULL AND paid_at IS NOT NULL AND method IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_seller_payouts_seller ON public.seller_payouts (seller_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_payouts_status ON public.seller_payouts (status, created_at);
ALTER TABLE public.seller_payouts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF to_regclass('public.migration_log') IS NOT NULL THEN
        INSERT INTO public.migration_log (name, note) VALUES ('20261027_seller_auctions', 'applied') ON CONFLICT (name) DO NOTHING;
    ELSE
        RAISE NOTICE 'migration_log does not exist yet: run 20261017 first, then re-run this file to record it.';
    END IF;
END $$;

COMMIT;

-- Verify:
--   SELECT to_regclass('public.auction_submissions'), to_regclass('public.seller_payouts');
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'auctions' AND column_name IN ('seller_account_id', 'submission_id');
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'income_ledger_kind_check';   -- includes 'payout'
--
-- Undo (only before any seller sale was confirmed; payout rows in the ledger cannot be deleted while the ledger lock is on):
--   DROP TABLE IF EXISTS public.seller_payouts;
--   ALTER TABLE public.auctions DROP COLUMN IF EXISTS submission_id, DROP COLUMN IF EXISTS seller_account_id;
--   DROP TABLE IF EXISTS public.auction_submissions;
--   DROP INDEX IF EXISTS public.uq_income_one_seller_share; DROP INDEX IF EXISTS public.uq_income_one_share_cancel;
--   ALTER TABLE public.income_ledger DROP CONSTRAINT income_ledger_kind_check;
--   ALTER TABLE public.income_ledger ADD CONSTRAINT income_ledger_kind_check CHECK (kind IN ('sale', 'refund', 'adjustment'));
