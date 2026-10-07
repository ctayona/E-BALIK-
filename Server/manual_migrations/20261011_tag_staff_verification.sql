-- 20261011: Smart Tag staff verification (fraud prevention).
-- Run in the Supabase SQL Editor AFTER 20261010_tag_photo_and_mission_control.sql. Additive and safe to re-run.
-- A newly registered tag, or a tag whose owner took a new photo, now waits in the status 'pending_verification' until
-- an admin has compared the screen with the real item. Tags that are already active stay active.

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.smart_tags') IS NULL THEN
        RAISE EXCEPTION 'public.smart_tags does not exist. Run 20261008_smart_tags.sql first.';
    END IF;
END $$;

-- The new status name is longer than the old VARCHAR(10), so the column is widened first. The two indexes that
-- mention status are dropped and rebuilt around the change.
DROP INDEX IF EXISTS public.idx_smart_tags_status;
DROP INDEX IF EXISTS public.idx_smart_tags_valid_until;

ALTER TABLE public.smart_tags DROP CONSTRAINT IF EXISTS smart_tags_status_check;
ALTER TABLE public.smart_tags ALTER COLUMN status TYPE VARCHAR(24);
ALTER TABLE public.smart_tags
    ADD CONSTRAINT smart_tags_status_check CHECK (status IN ('blank', 'pending_verification', 'active', 'lost', 'expired'));

ALTER TABLE public.smart_tags
    ADD COLUMN IF NOT EXISTS pending_image_url TEXT,                 -- a new photo waiting for approval (the approved photo stays in item_image_url)
    ADD COLUMN IF NOT EXISTS prior_status VARCHAR(10),               -- 'active' or 'lost': where the tag returns after a new photo is reviewed
    ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ,        -- when the owner submitted the registration or the new photo
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,                -- when staff last approved it
    ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS verification_note TEXT;                 -- the reason when staff rejected the last submission

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smart_tags_prior_status_check') THEN
        ALTER TABLE public.smart_tags
            ADD CONSTRAINT smart_tags_prior_status_check CHECK (prior_status IS NULL OR prior_status IN ('active', 'lost'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_smart_tags_status ON public.smart_tags(status);
CREATE INDEX IF NOT EXISTS idx_smart_tags_valid_until ON public.smart_tags(valid_until) WHERE status IN ('active', 'lost');
CREATE INDEX IF NOT EXISTS idx_smart_tags_pending ON public.smart_tags(review_requested_at) WHERE status = 'pending_verification';

COMMIT;

-- Verify:
--   SELECT character_maximum_length FROM information_schema.columns WHERE table_name = 'smart_tags' AND column_name = 'status';   -- 24
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'smart_tags_status_check';                                   -- includes pending_verification
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'smart_tags'
--    AND column_name IN ('pending_image_url','prior_status','review_requested_at','verified_at','verified_by','verification_note');  -- 6 rows
--   SELECT status, COUNT(*) FROM public.smart_tags GROUP BY status;                                                                 -- existing active tags unchanged
