-- 20261023: visual fingerprints for "search found items by photo". Run in the Supabase SQL Editor after 20261022.
-- Additive and safe to re-run. The app works without it (fingerprints are then rebuilt from the photos and kept in memory).
BEGIN;

ALTER TABLE public.found_items ADD COLUMN IF NOT EXISTS image_features JSONB;

DO $$
BEGIN
    IF to_regclass('public.migration_log') IS NOT NULL THEN
        INSERT INTO public.migration_log (name, note) VALUES ('20261023_image_features', 'applied') ON CONFLICT (name) DO NOTHING;
    ELSE
        RAISE NOTICE 'migration_log does not exist yet: run 20261017 first, then re-run this file to record it.';
    END IF;
END $$;

COMMIT;

-- Verify after running:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'found_items' AND column_name = 'image_features';
-- Rollback (only if needed): ALTER TABLE public.found_items DROP COLUMN image_features;
