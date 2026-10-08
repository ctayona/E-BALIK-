-- 20261019: Smart Tag contact links (Messenger, Facebook, Instagram, Telegram, WhatsApp, a second phone number).
-- Run in the Supabase SQL Editor AFTER 20261018_auction_handover_pin.sql. Additive and safe to re-run; nothing is deleted.
--
-- user_profiles.tag_contacts: the owner's saved contact methods, as {"messenger": "username", "whatsapp": "63917...", ...}. Private to the owner:
--   it is only ever read by the backend, which turns the methods an owner switched on for a tag into links for finders.
-- smart_tags.shown_contacts: which of those methods this tag shows to a finder, as ["messenger", "phone2"]. Empty by default (nothing extra is shared).

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.smart_tags') IS NULL THEN
        RAISE EXCEPTION 'The smart_tags table is missing. Run 20261008_smart_tags.sql first.';
    END IF;
END $$;

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS tag_contacts JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.smart_tags    ADD COLUMN IF NOT EXISTS shown_contacts JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
    IF to_regclass('public.migration_log') IS NOT NULL THEN
        INSERT INTO public.migration_log (name, note) VALUES ('20261019_tag_contact_links', 'applied') ON CONFLICT (name) DO NOTHING;
    ELSE
        RAISE NOTICE 'migration_log does not exist yet: run 20261017 first, then re-run this file to record it.';
    END IF;
END $$;

COMMIT;

-- Verify after running:
--   SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
--     AND ((table_name = 'user_profiles' AND column_name = 'tag_contacts') OR (table_name = 'smart_tags' AND column_name = 'shown_contacts'));   -- 2 rows
--
-- Rollback (only if needed): ALTER TABLE public.user_profiles DROP COLUMN tag_contacts; ALTER TABLE public.smart_tags DROP COLUMN shown_contacts;
