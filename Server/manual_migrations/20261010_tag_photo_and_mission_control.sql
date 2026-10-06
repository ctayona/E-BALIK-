-- 20261010: Smart Tag item photo (live camera registration) and Mission Control storage tools.
-- Run in the Supabase SQL Editor AFTER 20261009_tag_expiry_and_auction_buyout.sql. Additive and safe to re-run.
-- It adds one column, one PRIVATE storage bucket and two read-only functions. It deletes nothing and changes no existing row.
-- The announcement banner, messages and admin governance need no schema: they use the existing system_settings,
-- user_notifications and user_profiles tables.

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.smart_tags') IS NULL THEN
        RAISE EXCEPTION 'public.smart_tags does not exist. Run 20261008_smart_tags.sql first.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------------------------- Smart Tag photo
-- Holds the storage path of the photo taken with the camera at registration (NOT a public link).
-- Finders get a short-lived signed link, so the picture is never reachable without scanning the tag.
ALTER TABLE public.smart_tags ADD COLUMN IF NOT EXISTS item_image_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('smart-tag-images', 'smart-tag-images', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = 5242880,
        allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- ---------------------------------------------------------------------------------------------- Mission Control storage tools
-- Object counts and sizes per bucket, for the "Storage" card.
CREATE OR REPLACE FUNCTION public.storage_bucket_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;
    RETURN (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'bucket', b.id,
                   'objects', coalesce(o.objects, 0),
                   'bytes', coalesce(o.bytes, 0)
               ) ORDER BY b.id), '[]'::jsonb)
          FROM storage.buckets b
          LEFT JOIN (
              SELECT bucket_id, count(*) AS objects, sum(coalesce((metadata ->> 'size')::bigint, 0)) AS bytes
                FROM storage.objects
               GROUP BY bucket_id
          ) o ON o.bucket_id = b.id
    );
END;
$$;

-- One page of object names, sizes and ages in a bucket, for the orphan scan.
CREATE OR REPLACE FUNCTION public.storage_list_objects(p_bucket TEXT, p_limit INTEGER, p_offset INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;
    RETURN (
        SELECT coalesce(jsonb_agg(page.item), '[]'::jsonb)
          FROM (
              SELECT jsonb_build_object(
                         'name', name,
                         'size', coalesce((metadata ->> 'size')::bigint, 0),
                         'created_at', created_at
                     ) AS item
                FROM storage.objects
               WHERE bucket_id = p_bucket
                 AND name NOT LIKE '%.emptyFolderPlaceholder'
               ORDER BY name
               LIMIT greatest(least(coalesce(p_limit, 1000), 1000), 1)
              OFFSET greatest(coalesce(p_offset, 0), 0)
          ) page
    );
END;
$$;

REVOKE ALL ON FUNCTION public.storage_bucket_stats() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.storage_list_objects(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_bucket_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.storage_list_objects(TEXT, INTEGER, INTEGER) TO service_role;

COMMIT;

-- Verify:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'smart_tags' AND column_name = 'item_image_url';
--   SELECT id, public FROM storage.buckets WHERE id = 'smart-tag-images';      -- public must be false
--   SELECT proname FROM pg_proc WHERE proname IN ('storage_bucket_stats', 'storage_list_objects');
