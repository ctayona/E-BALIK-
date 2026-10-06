-- 20261008: Smart Tags (QR stickers). Run in the Supabase SQL Editor after 20261007_report_integrity_and_reactions.sql.
-- Additive and safe to re-run. It changes no existing table or row.
--
-- tag_id is the secret-ish public code printed in the QR URL (/tag/<tag_id>). The backend generates it with a
-- cryptographically secure random generator (12 characters from a 32-letter alphabet, about 60 bits), so it cannot be
-- guessed or enumerated. The CHECK below only enforces the format.

BEGIN;

CREATE TABLE IF NOT EXISTS public.smart_tags (
    tag_id VARCHAR(12) PRIMARY KEY CHECK (tag_id ~ '^[A-Z0-9]{10,12}$'),
    owner_account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    item_name VARCHAR(120),
    item_description TEXT,
    status VARCHAR(10) NOT NULL DEFAULT 'blank' CHECK (status IN ('blank', 'active', 'lost')),

    -- What a finder is allowed to see. Everything is hidden unless the owner switches it on.
    show_name BOOLEAN NOT NULL DEFAULT FALSE,
    show_email BOOLEAN NOT NULL DEFAULT FALSE,
    show_phone BOOLEAN NOT NULL DEFAULT FALSE,
    contact_phone VARCHAR(30),

    -- Admin control: a disabled tag shows nothing to finders and cannot be edited by its owner.
    is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
    disabled_reason VARCHAR(300),
    disabled_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    disabled_at TIMESTAMPTZ,

    batch_label VARCHAR(80),
    created_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    last_found_notice_at TIMESTAMPTZ,
    found_notice_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A blank tag has no owner details yet; a claimed tag has an item name.
    CONSTRAINT smart_tags_blank_has_no_details CHECK (status <> 'blank' OR (item_name IS NULL AND NOT show_name AND NOT show_email AND NOT show_phone))
);

CREATE INDEX IF NOT EXISTS idx_smart_tags_owner ON public.smart_tags(owner_account_id);
CREATE INDEX IF NOT EXISTS idx_smart_tags_status ON public.smart_tags(status);
CREATE INDEX IF NOT EXISTS idx_smart_tags_created_at ON public.smart_tags(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_smart_tags_batch ON public.smart_tags(batch_label);

-- Only the backend (service key) reads or writes this table. The public page goes through the API, which returns
-- an explicit allow-list of fields, so no policy is created and anonymous database access stays closed.
ALTER TABLE public.smart_tags ENABLE ROW LEVEL SECURITY;

COMMIT;
