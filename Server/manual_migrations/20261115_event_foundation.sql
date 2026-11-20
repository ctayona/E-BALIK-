-- Draft event foundation. User runs manually; Codex must not apply this remotely.
-- Follows existing UUID, VARCHAR, TIMESTAMPTZ, JSONB and migration_log conventions.
-- No report/tag/payment columns, existing data changes, public access or operational events.
-- Read docs/EVENT_FOUNDATION_IMPLEMENTATION.md before applying.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
    IF to_regclass('public.user_profiles') IS NULL OR to_regclass('public.migration_log') IS NULL THEN
        RAISE EXCEPTION 'Existing user_profiles and migration_log are required.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.migration_log WHERE name = '20261115_event_foundation') THEN
        RAISE EXCEPTION 'Event foundation is already recorded; verify it instead of re-running.';
    END IF;
    IF to_regclass('public.event_workspaces') IS NOT NULL OR to_regclass('public.event_memberships') IS NOT NULL THEN
        RAISE EXCEPTION 'Event table name collision; inspect the existing tables before proceeding.';
    END IF;
END $$;

CREATE TABLE public.event_workspaces (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) > 0),
    slug VARCHAR(80) NOT NULL UNIQUE CHECK (length(slug) BETWEEN 3 AND 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    organizer_name VARCHAR(160) NOT NULL DEFAULT '',
    venue VARCHAR(240) NOT NULL DEFAULT '',
    desk_instructions VARCHAR(1000) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status = 'draft'),
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    recovery_ends_at TIMESTAMPTZ,
    branding JSONB NOT NULL DEFAULT '{"template":"classic","primary":"#1f3160","accent":"#d1a153","background":"#ffffff"}'::jsonb,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT event_dates_check CHECK (
        (starts_at IS NULL AND ends_at IS NULL AND recovery_ends_at IS NULL) OR
        (starts_at IS NOT NULL AND ends_at IS NOT NULL AND recovery_ends_at IS NOT NULL
         AND starts_at < ends_at AND ends_at <= recovery_ends_at)),
    CONSTRAINT event_branding_check CHECK (
        jsonb_typeof(branding) = 'object' AND
        branding ?& ARRAY['template','primary','accent','background'] AND
        branding - ARRAY['template','primary','accent','background'] = '{}'::jsonb AND
        jsonb_typeof(branding->'template') = 'string' AND
        branding->>'template' IN ('classic','festival','sports') AND
        jsonb_typeof(branding->'primary') = 'string' AND branding->>'primary' ~ '^#[0-9a-fA-F]{6}$' AND
        jsonb_typeof(branding->'accent') = 'string' AND branding->>'accent' ~ '^#[0-9a-fA-F]{6}$' AND
        jsonb_typeof(branding->'background') = 'string' AND branding->>'background' ~ '^#[0-9a-fA-F]{6}$')
);
CREATE INDEX idx_event_workspaces_created ON public.event_workspaces (created_at DESC);
CREATE INDEX idx_event_workspaces_creator ON public.event_workspaces (created_by);

-- Reserved membership structure: no invitation/assignment API in this release.
CREATE TABLE public.event_memberships (
    membership_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.event_workspaces(event_id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES public.user_profiles(account_id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('manager','desk_staff')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
    starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    assigned_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, account_id),
    CHECK (starts_at < expires_at)
);
CREATE INDEX idx_event_memberships_account ON public.event_memberships (account_id, event_id);
CREATE INDEX idx_event_memberships_assigner ON public.event_memberships (assigned_by);

ALTER TABLE public.event_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_memberships ENABLE ROW LEVEL SECURITY;
-- Match server-only architecture, but explicitly remove default browser-role grants.
REVOKE ALL ON public.event_workspaces, public.event_memberships FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.event_workspaces, public.event_memberships FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.event_workspaces TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.event_memberships TO service_role;

INSERT INTO public.migration_log (name, note)
VALUES ('20261115_event_foundation', 'Draft-only event configuration; no campus report integration');
COMMIT;
