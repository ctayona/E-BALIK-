-- 20261021: Comments and "helpful" reactions on missing and found reports (the user home feed).
-- Run in the Supabase SQL Editor AFTER 20261020_otp_attempts.sql. Additive and safe to re-run; nothing is deleted.
--
-- report_comments: a short public comment under one found report or one missing report. Hidden comments (moderation) are kept but never shown.
-- report_reactions: one "helpful" (upvote) per person per report.
-- Each row points at exactly ONE report (found_item_id or missing_item_id), so deleting a report deletes its comments and reactions with it.
-- Only the backend (service role) reads or writes these tables: RLS is on and there are no policies.

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.found_items') IS NULL OR to_regclass('public.missing_items') IS NULL OR to_regclass('public.user_profiles') IS NULL THEN
        RAISE EXCEPTION 'The found_items, missing_items or user_profiles table is missing. Run the earlier migrations first.';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.report_comments (
    comment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    found_item_id UUID REFERENCES public.found_items(item_id) ON DELETE CASCADE,
    missing_item_id UUID REFERENCES public.missing_items(item_id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.user_profiles(account_id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
    is_hidden BOOLEAN NOT NULL DEFAULT false,
    hidden_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    hidden_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT report_comments_one_report CHECK ((found_item_id IS NOT NULL)::int + (missing_item_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS idx_report_comments_found ON public.report_comments (found_item_id, created_at DESC) WHERE found_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_report_comments_missing ON public.report_comments (missing_item_id, created_at DESC) WHERE missing_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_report_comments_account ON public.report_comments (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.report_reactions (
    reaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    found_item_id UUID REFERENCES public.found_items(item_id) ON DELETE CASCADE,
    missing_item_id UUID REFERENCES public.missing_items(item_id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.user_profiles(account_id) ON DELETE CASCADE,
    kind VARCHAR(12) NOT NULL DEFAULT 'helpful' CHECK (kind IN ('helpful')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT report_reactions_one_report CHECK ((found_item_id IS NOT NULL)::int + (missing_item_id IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_reactions_found ON public.report_reactions (found_item_id, account_id, kind) WHERE found_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_reactions_missing ON public.report_reactions (missing_item_id, account_id, kind) WHERE missing_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_report_reactions_account ON public.report_reactions (account_id);

ALTER TABLE public.report_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_reactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF to_regclass('public.migration_log') IS NOT NULL THEN
        INSERT INTO public.migration_log (name, note) VALUES ('20261021_report_comments_and_reactions', 'applied') ON CONFLICT (name) DO NOTHING;
    ELSE
        RAISE NOTICE 'migration_log does not exist yet: run 20261017 first, then re-run this file to record it.';
    END IF;
END $$;

COMMIT;

-- Verify after running:
--   SELECT to_regclass('public.report_comments'), to_regclass('public.report_reactions');
--
-- Rollback (only if needed): DROP TABLE public.report_reactions; DROP TABLE public.report_comments;
