-- 20261026: lock the income ledger. Run in the Supabase SQL Editor after 20261022 (and 20261024, 20261025 if you have run them).
-- The app only ever ADDS rows to the ledger (a mistake is fixed with a reversal or an adjustment). This makes the database enforce it too,
-- so a future bug, a wrong query in the SQL Editor or a script cannot quietly change or erase money records.
--   * DELETE is refused.
--   * UPDATE is refused, with two exceptions that are harmless and needed:
--       - a row updated to exactly what it already is (a restore that merges identical rows);
--       - the database blanking payer_account_id or recorded_by when a person's account is removed (the foreign keys are ON DELETE SET NULL).
--     Amounts, dates, references, receipt numbers and notes can never change.
--   * TRUNCATE is refused.
-- Safe to re-run. To undo, see the last lines of this file.
BEGIN;

DO $$
BEGIN
    IF to_regclass('public.income_ledger') IS NULL THEN
        RAISE EXCEPTION 'income_ledger does not exist yet. Run 20261022_income_ledger.sql first.';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.income_ledger_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Income ledger entries cannot be deleted. Add a reversal or an adjustment instead.'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    -- UPDATE
    IF NEW IS NOT DISTINCT FROM OLD THEN
        RETURN NEW;                                   -- nothing changes: harmless (a restore merging identical rows)
    END IF;
    IF (to_jsonb(NEW) - 'payer_account_id' - 'recorded_by') = (to_jsonb(OLD) - 'payer_account_id' - 'recorded_by')
       AND (NEW.payer_account_id IS NULL OR NEW.payer_account_id IS NOT DISTINCT FROM OLD.payer_account_id)
       AND (NEW.recorded_by IS NULL OR NEW.recorded_by IS NOT DISTINCT FROM OLD.recorded_by) THEN
        RETURN NEW;                                   -- only a person's link was blanked because their account was removed
    END IF;
    RAISE EXCEPTION 'Income ledger entries cannot be edited. Add a reversal or an adjustment instead.'
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE OR REPLACE FUNCTION public.income_ledger_no_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'The income ledger cannot be emptied.' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_income_ledger_guard ON public.income_ledger;
CREATE TRIGGER trg_income_ledger_guard
    BEFORE UPDATE OR DELETE ON public.income_ledger
    FOR EACH ROW EXECUTE FUNCTION public.income_ledger_guard();

DROP TRIGGER IF EXISTS trg_income_ledger_no_truncate ON public.income_ledger;
CREATE TRIGGER trg_income_ledger_no_truncate
    BEFORE TRUNCATE ON public.income_ledger
    FOR EACH STATEMENT EXECUTE FUNCTION public.income_ledger_no_truncate();

DO $$
BEGIN
    IF to_regclass('public.migration_log') IS NOT NULL THEN
        INSERT INTO public.migration_log (name, note) VALUES ('20261026_income_ledger_lock', 'applied') ON CONFLICT (name) DO NOTHING;
    ELSE
        RAISE NOTICE 'migration_log does not exist yet: run 20261017 first, then re-run this file to record it.';
    END IF;
END $$;

COMMIT;

-- Verify after running (both rows must appear):
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.income_ledger'::regclass AND NOT tgisinternal ORDER BY tgname;
--     -> trg_income_ledger_guard, trg_income_ledger_no_truncate
-- Undo (only if you must correct the ledger by hand, then run this file again):
--   DROP TRIGGER IF EXISTS trg_income_ledger_guard ON public.income_ledger;
--   DROP TRIGGER IF EXISTS trg_income_ledger_no_truncate ON public.income_ledger;
