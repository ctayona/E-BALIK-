-- 20261014: Recycle bin. Nothing an admin deletes (and no ID document or proof photo removed by the retention rule) is gone for good
-- until it has sat in the bin for the retention period or a super admin empties it with their authenticator code.
-- Run in the Supabase SQL Editor AFTER 20261013_guard_role_reminders_and_retention.sql. Additive and safe to re-run; nothing is deleted.
--
-- recycle_bin keeps one row per deleted thing: a JSON snapshot of the record and everything that was deleted with it, and the list of
-- files copied into the private storage bucket `recycle-bin`. Restoring puts the rows and files back. Purging (by hand or when
-- `expires_at` passes) removes the files and empties the snapshot, leaving only a small tombstone row (what, when, who).

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.user_profiles') IS NULL THEN
        RAISE EXCEPTION 'public.user_profiles does not exist. Run the earlier migrations first.';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.recycle_bin (
    archive_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('claim', 'found_item', 'missing_item', 'user', 'auction', 'evidence')),
    entity_id TEXT NOT NULL,                       -- claim id, item reference, account id, auction id
    label TEXT NOT NULL,                           -- what the super admin sees, e.g. "Found item FP1001: Blue umbrella"
    reason VARCHAR(20) NOT NULL DEFAULT 'admin_delete' CHECK (reason IN ('admin_delete', 'retention')),
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"table": [rows]} of everything deleted together; emptied when restored or purged
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {"claims": 2, "found_items": 1}: shown in the list without loading the snapshot
    files JSONB NOT NULL DEFAULT '[]'::jsonb,      -- [{"bucket", "path", "archive_path", "bytes"}] copied into the recycle-bin bucket
    deleted_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    deleted_by_label TEXT,
    deleted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,  -- purged automatically after this
    status VARCHAR(10) NOT NULL DEFAULT 'archived' CHECK (status IN ('archived', 'restored', 'purged')),
    finished_at TIMESTAMP WITH TIME ZONE,
    finished_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_recycle_bin_archived ON public.recycle_bin (deleted_at DESC) WHERE status = 'archived';
CREATE INDEX IF NOT EXISTS idx_recycle_bin_expiry ON public.recycle_bin (expires_at) WHERE status = 'archived';
CREATE INDEX IF NOT EXISTS idx_recycle_bin_entity ON public.recycle_bin (entity_type, entity_id);

-- Only the backend (service role) reads or writes it: RLS on, no policies.
ALTER TABLE public.recycle_bin ENABLE ROW LEVEL SECURITY;

-- Private storage for the files of archived records (the largest allowed size matches the biggest upload bucket).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('recycle-bin', 'recycle-bin', false, 26214400)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Verify:
--   SELECT to_regclass('public.recycle_bin');                                              -- recycle_bin
--   SELECT id, public FROM storage.buckets WHERE id = 'recycle-bin';                       -- public must be false
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.recycle_bin'::regclass;        -- true
--
-- Rollback (only if the bin is empty, otherwise archived records are lost):
--   DROP TABLE IF EXISTS public.recycle_bin;
--   DELETE FROM storage.buckets WHERE id = 'recycle-bin';   -- empty the bucket first in the Storage page
