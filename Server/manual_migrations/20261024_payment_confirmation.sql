-- 20261024: payment confirmation. Run in the Supabase SQL Editor after 20261022.
-- Income now counts only after an administrator confirms the payment. The confirmation stores the payer's reference number
-- (GCash, Maya or bank transfer reference) next to the sale. Additive and safe to re-run.
BEGIN;

ALTER TABLE public.income_ledger ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_income_payer ON public.income_ledger (payer_account_id);

DO $$
BEGIN
    IF to_regclass('public.migration_log') IS NOT NULL THEN
        INSERT INTO public.migration_log (name, note) VALUES ('20261024_payment_confirmation', 'applied') ON CONFLICT (name) DO NOTHING;
    ELSE
        RAISE NOTICE 'migration_log does not exist yet: run 20261017 first, then re-run this file to record it.';
    END IF;
END $$;

COMMIT;

-- Verify after running:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'income_ledger' AND column_name = 'payment_reference';
-- Rollback (only if needed): ALTER TABLE public.income_ledger DROP COLUMN payment_reference;
