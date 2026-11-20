-- User-run after 20261115_event_foundation. Internal lifecycle only, no public/report access.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.migration_log WHERE name='20261115_event_foundation') THEN
        RAISE EXCEPTION 'Event foundation is required.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.migration_log WHERE name='20261116_event_lifecycle')
       OR to_regclass('public.event_state_history') IS NOT NULL
       OR to_regprocedure('public.event_transition(uuid,uuid,integer,text,text)') IS NOT NULL THEN
        RAISE EXCEPTION 'Lifecycle objects already exist. Verify instead of rerunning.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.event_workspaces'::regclass AND conname='event_workspaces_status_check' AND pg_get_constraintdef(oid) LIKE '%draft%') THEN
        RAISE EXCEPTION 'Expected event status constraint missing; review schema drift.';
    END IF;
END $$;
ALTER TABLE public.event_workspaces DROP CONSTRAINT event_workspaces_status_check;
ALTER TABLE public.event_workspaces ADD CONSTRAINT event_workspaces_status_check
CHECK (status IN ('draft','scheduled','active','recovery','closed','archived','cancelled'));
CREATE TABLE public.event_state_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.event_workspaces(event_id) ON DELETE RESTRICT,
    actor_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    from_status VARCHAR(20) NOT NULL CHECK (from_status IN ('draft','scheduled','active','recovery','closed','archived','cancelled')),
    to_status VARCHAR(20) NOT NULL CHECK (to_status IN ('draft','scheduled','active','recovery','closed','archived','cancelled')),
    note VARCHAR(1000) NOT NULL CHECK (length(btrim(note)) BETWEEN 5 AND 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_event_state_history_event ON public.event_state_history(event_id,created_at DESC);
CREATE INDEX idx_event_state_history_actor ON public.event_state_history(actor_id);
ALTER TABLE public.event_state_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_state_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.event_state_history TO service_role;

CREATE FUNCTION public.event_transition(p_event_id UUID,p_actor_id UUID,p_version INTEGER,p_target TEXT,p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE e public.event_workspaces%ROWTYPE; old_state TEXT; stamp TIMESTAMPTZ:=clock_timestamp(); ready BOOLEAN; allowed BOOLEAN:=false;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE account_id=p_actor_id AND access_level='super_admin' AND is_active IS TRUE AND (suspended_until IS NULL OR suspended_until<=stamp)) THEN
        RETURN jsonb_build_object('ok',false,'error','Active super administrator required.');
    END IF;
    IF p_version IS NULL OR p_version<1 OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 5 AND 1000 OR p_note ~ '[<>[:cntrl:]]' THEN
        RETURN jsonb_build_object('ok',false,'error','Current version and a plain-text transition reason are required.');
    END IF;
    SELECT * INTO e FROM public.event_workspaces WHERE event_id=p_event_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Event not found.'); END IF;
    IF e.version<>p_version THEN RETURN jsonb_build_object('ok',false,'error','Event changed. Refresh before continuing.'); END IF;
    ready:=length(btrim(e.name))>0 AND length(btrim(e.organizer_name))>0 AND length(btrim(e.desk_instructions))>0
      AND e.venue IN ('Library','Gymnasium','Cafeteria','Admin Building','Oval Track','Engineering Building','Lost and Found Office')
      AND e.starts_at IS NOT NULL AND e.ends_at IS NOT NULL AND e.recovery_ends_at IS NOT NULL
      AND e.starts_at<e.ends_at AND e.ends_at<=e.recovery_ends_at AND e.ends_at>stamp
      AND EXISTS (SELECT 1 FROM public.event_memberships m JOIN public.user_profiles u USING(account_id)
                  WHERE m.event_id=e.event_id AND m.role='manager' AND m.status='active' AND m.starts_at<=stamp
                  AND m.expires_at>stamp AND m.expires_at>=e.recovery_ends_at AND u.is_active IS TRUE
                  AND (u.suspended_until IS NULL OR u.suspended_until<=stamp));
    IF e.status='draft' AND p_target='scheduled' THEN allowed:=ready AND e.starts_at>stamp;
    ELSIF e.status IN ('draft','scheduled') AND p_target='active' THEN allowed:=ready AND e.starts_at<=stamp AND stamp<e.ends_at;
    ELSIF e.status='scheduled' AND p_target='draft' THEN allowed:=stamp<e.starts_at;
    ELSIF e.status='active' AND p_target='recovery' THEN allowed:=stamp>=e.ends_at;
    ELSIF e.status='recovery' AND p_target='closed' THEN allowed:=stamp>=e.recovery_ends_at;
    ELSIF e.status='closed' AND p_target='archived' THEN allowed:=true;
    ELSIF e.status IN ('draft','scheduled','active','recovery') AND p_target='cancelled' THEN allowed:=true;
    END IF;
    IF allowed IS NOT TRUE THEN RETURN jsonb_build_object('ok',false,'error','Transition not allowed. Check readiness, dates and current event state.'); END IF;
    old_state:=e.status;
    UPDATE public.event_workspaces SET status=p_target,version=version+1,updated_at=stamp WHERE event_id=e.event_id RETURNING * INTO e;
    INSERT INTO public.event_state_history(event_id,actor_id,from_status,to_status,note,created_at)
    VALUES(e.event_id,p_actor_id,old_state,p_target,btrim(p_note),stamp);
    RETURN jsonb_build_object('ok',true,'event',to_jsonb(e));
END $$;
REVOKE ALL ON FUNCTION public.event_transition(UUID,UUID,INTEGER,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_transition(UUID,UUID,INTEGER,TEXT,TEXT) TO service_role;
INSERT INTO public.migration_log(name,note) VALUES('20261116_event_lifecycle','Private event readiness/lifecycle and atomic state history; public reports remain closed');
COMMIT;
