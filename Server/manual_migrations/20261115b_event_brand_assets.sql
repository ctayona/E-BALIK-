-- User-run migration after 20261115_event_foundation. New private artwork objects only.
-- No changes to campus image buckets, reports, tags, payment tables or ledger protection.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.migration_log WHERE name='20261115_event_foundation') THEN
        RAISE EXCEPTION 'Run 20261115_event_foundation first.';
    END IF;
    IF to_regclass('public.event_brand_assets') IS NOT NULL
       OR EXISTS (SELECT 1 FROM storage.buckets WHERE id='event-brand-assets')
       OR EXISTS (SELECT 1 FROM public.migration_log WHERE name='20261115b_event_brand_assets') THEN
        RAISE EXCEPTION 'Artwork objects already exist. Verify the installation; do not overwrite.';
    END IF;
    -- Generic browser policies would also affect a new private bucket. Require review first.
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
               AND (roles && ARRAY['public','anon','authenticated']::name[])
              ) THEN
        RAISE EXCEPTION 'Browser Storage policies require review before adding this private event bucket.';
    END IF;
END $$;
CREATE TABLE public.event_brand_assets (
    asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.event_workspaces(event_id) ON DELETE RESTRICT,
    kind VARCHAR(10) NOT NULL CHECK (kind IN ('logo','banner')),
    object_path VARCHAR(255),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id,kind),
    CHECK (object_path IS NULL OR object_path ~ ('^' || event_id::text || '/' || kind || '/[0-9a-f]{32}\.webp$'))
);
CREATE INDEX idx_event_brand_assets_updater ON public.event_brand_assets(updated_by);
ALTER TABLE public.event_brand_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_brand_assets FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT,INSERT,UPDATE ON public.event_brand_assets TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('event-brand-assets','event-brand-assets',false,5242880,ARRAY['image/webp']);
INSERT INTO public.migration_log(name,note)
VALUES ('20261115b_event_brand_assets','Private draft logos/banners with revision-safe metadata');
COMMIT;
