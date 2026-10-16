-- 20261020: Count wrong guesses on one-time codes.
-- Run in the Supabase SQL Editor AFTER 20261019_tag_contact_links.sql. Additive and safe to re-run; nothing is deleted.
--
-- otp_tokens.attempts: how many wrong codes were tried against this code. At 5 the code is retired (is_used = true) and a new one must be requested.
-- The index serves the "how many codes did this email ask for in 24 hours" check behind the cooldown and the daily limit.
-- The server already limits wrong guesses and code requests without this migration (in memory, per server); the migration makes the guess
-- counter permanent and shared between servers.

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.otp_tokens') IS NULL THEN
        RAISE EXCEPTION 'The otp_tokens table is missing. Run Server/database_schema.sql first.';
    END IF;
END $$;

ALTER TABLE public.otp_tokens ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_otp_tokens_email_created ON public.otp_tokens (email, created_at DESC);

DO $$
BEGIN
    IF to_regclass('public.migration_log') IS NOT NULL THEN
        INSERT INTO public.migration_log (name, note) VALUES ('20261020_otp_attempts', 'applied') ON CONFLICT (name) DO NOTHING;
    ELSE
        RAISE NOTICE 'migration_log does not exist yet: run 20261017 first, then re-run this file to record it.';
    END IF;
END $$;

COMMIT;

-- Verify after running:
--   SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'otp_tokens' AND column_name = 'attempts';   -- 1 row
--
-- Rollback (only if needed): DROP INDEX IF EXISTS public.idx_otp_tokens_email_created; ALTER TABLE public.otp_tokens DROP COLUMN attempts;
