-- 20261025: payment proofs (GCash, Maya and bank receipts) and photo matching for lost reports. Run in the Supabase SQL Editor after 20261024.
-- Additive and safe to re-run.
--   * private storage bucket `payment-proofs` for the payer's payment screenshot (administrators see it through short-lived signed links);
--   * `payment_proofs`: what a payer submitted for an auction win or a Smart Tag, and what the administrator decided;
--   * `income_ledger.proof_path`: the proof kept with a confirmed payment;
--   * `missing_items.image_features`: the visual fingerprint of a lost report's photo, so AI matching can compare photos.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('payment-proofs', 'payment-proofs', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.payment_proofs (
    proof_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(20) NOT NULL CHECK (source IN ('auction', 'smart_tag')),
    source_ref VARCHAR(64) NOT NULL,
    payer_account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    method VARCHAR(20) NOT NULL CHECK (method IN ('cash', 'gcash', 'maya', 'bank', 'other')),
    reference VARCHAR(64),
    note VARCHAR(300),
    image_path VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'replaced')),
    reviewed_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_note VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_proofs_item ON public.payment_proofs (source, source_ref, status);
CREATE INDEX IF NOT EXISTS idx_payment_proofs_payer ON public.payment_proofs (payer_account_id, created_at DESC);
ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.income_ledger ADD COLUMN IF NOT EXISTS proof_path VARCHAR(255);
ALTER TABLE public.missing_items ADD COLUMN IF NOT EXISTS image_features JSONB;

DO $$
BEGIN
    IF to_regclass('public.migration_log') IS NOT NULL THEN
        INSERT INTO public.migration_log (name, note) VALUES ('20261025_payment_proofs_and_matching', 'applied') ON CONFLICT (name) DO NOTHING;
    ELSE
        RAISE NOTICE 'migration_log does not exist yet: run 20261017 first, then re-run this file to record it.';
    END IF;
END $$;

COMMIT;

-- Verify after running:
--   SELECT id, public FROM storage.buckets WHERE id = 'payment-proofs';            -- public must be false
--   SELECT to_regclass('public.payment_proofs');
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'income_ledger' AND column_name = 'proof_path';
