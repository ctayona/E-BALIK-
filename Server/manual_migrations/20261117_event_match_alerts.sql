-- USER-RUN ONLY after 20261116c_event_recovery. Event-only in-app notices; no email/campus changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.migration_log WHERE name='20261116c_event_recovery')
    OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='event_reports' AND column_name='released_at')
    OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='event_workspaces' AND column_name='deleted_at') THEN
    RAISE EXCEPTION 'Apply and verify event recovery first.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.migration_log WHERE name='20261117_event_match_alerts')
    OR to_regclass('public.event_match_alerts') IS NOT NULL OR to_regclass('public.event_alert_history') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('event_alert_guard','event_invalidate_alerts','event_send_match_alert','event_alert_action','event_alert_unread_count')) THEN
    RAISE EXCEPTION 'Event alert objects already exist. Verify instead of overwriting.';
  END IF;
END $$;
CREATE TABLE public.event_match_alerts (
  alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  missing_report_id UUID NOT NULL,
  found_report_id UUID NOT NULL,
  recipient_account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  sent_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  missing_version INTEGER NOT NULL CHECK(missing_version>0),
  found_version INTEGER NOT NULL CHECK(found_version>0),
  status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  invalidated_at TIMESTAMPTZ,
  inactive_reason VARCHAR(24) CHECK(inactive_reason IN ('event_closed','report_unavailable')),
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id,alert_id), UNIQUE(event_id,missing_report_id,found_report_id),
  FOREIGN KEY(event_id,missing_report_id) REFERENCES public.event_reports(event_id,report_id) ON DELETE RESTRICT,
  FOREIGN KEY(event_id,found_report_id) REFERENCES public.event_reports(event_id,report_id) ON DELETE RESTRICT,
  CHECK(missing_report_id<>found_report_id),
  CHECK((status='active' AND invalidated_at IS NULL AND inactive_reason IS NULL)
    OR (status='inactive' AND invalidated_at IS NOT NULL AND inactive_reason IS NOT NULL)),
  CHECK(read_at IS NULL OR read_at>=created_at),
  CHECK(invalidated_at IS NULL OR invalidated_at>=created_at),
  CHECK(dismissed_at IS NULL OR (read_at IS NOT NULL AND dismissed_at>=read_at))
);
CREATE INDEX idx_event_alert_recipient ON public.event_match_alerts(recipient_account_id,event_id,created_at DESC,alert_id);
CREATE INDEX idx_event_alert_unread ON public.event_match_alerts(recipient_account_id,event_id) WHERE status='active' AND read_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX idx_event_alert_found ON public.event_match_alerts(event_id,found_report_id);
CREATE INDEX idx_event_alert_sender ON public.event_match_alerts(sent_by,event_id,created_at DESC);
CREATE TABLE public.event_alert_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  alert_id UUID NOT NULL,
  actor_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  action VARCHAR(12) NOT NULL CHECK(action IN ('sent','read','dismissed','inactive')),
  note VARCHAR(300) NOT NULL CHECK(length(btrim(note)) BETWEEN 5 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(event_id,alert_id) REFERENCES public.event_match_alerts(event_id,alert_id) ON DELETE RESTRICT
);
CREATE INDEX idx_event_alert_history_alert ON public.event_alert_history(event_id,alert_id,created_at DESC);
CREATE INDEX idx_event_alert_history_actor ON public.event_alert_history(actor_id);
ALTER TABLE public.event_match_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_alert_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_match_alerts,public.event_alert_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.event_match_alerts TO service_role;
GRANT SELECT,INSERT ON public.event_alert_history TO service_role;

CREATE FUNCTION public.event_alert_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE m public.event_reports%ROWTYPE; f public.event_reports%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO m FROM public.event_reports WHERE event_id=NEW.event_id AND report_id=NEW.missing_report_id;
    SELECT * INTO f FROM public.event_reports WHERE event_id=NEW.event_id AND report_id=NEW.found_report_id;
    IF m.kind IS DISTINCT FROM 'missing' OR f.kind IS DISTINCT FROM 'found' OR NEW.recipient_account_id IS DISTINCT FROM m.reporter_account_id THEN
      RAISE EXCEPTION 'An event alert must target the owner of its missing report and a found report in the same event.';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['recipient_account_id','sent_by','status','invalidated_at','inactive_reason','read_at','dismissed_at','updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['recipient_account_id','sent_by','status','invalidated_at','inactive_reason','read_at','dismissed_at','updated_at'])
      OR (NEW.recipient_account_id IS DISTINCT FROM OLD.recipient_account_id AND NEW.recipient_account_id IS NOT NULL)
      OR (NEW.sent_by IS DISTINCT FROM OLD.sent_by AND NEW.sent_by IS NOT NULL)
      OR (OLD.status='inactive' AND NEW.status<>'inactive')
      OR (OLD.invalidated_at IS NOT NULL AND (NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at OR NEW.inactive_reason IS DISTINCT FROM OLD.inactive_reason))
      OR (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at)
      OR (OLD.dismissed_at IS NOT NULL AND NEW.dismissed_at IS DISTINCT FROM OLD.dismissed_at) THEN
      RAISE EXCEPTION 'Alert scope, recipient and existing acknowledgement cannot be rewritten.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_event_alert_guard BEFORE INSERT OR UPDATE ON public.event_match_alerts FOR EACH ROW EXECUTE FUNCTION public.event_alert_guard();

CREATE FUNCTION public.event_invalidate_alerts() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE changed RECORD; stamp TIMESTAMPTZ:=clock_timestamp(); reason TEXT;
BEGIN
  IF TG_TABLE_NAME='event_workspaces' THEN
    IF NEW.status NOT IN ('closed','cancelled','archived') AND NEW.deleted_at IS NULL THEN RETURN NEW; END IF;
    reason:='event_closed';
    FOR changed IN UPDATE public.event_match_alerts SET status='inactive',invalidated_at=stamp,inactive_reason=reason,updated_at=stamp
      WHERE event_id=NEW.event_id AND status='active' RETURNING alert_id LOOP
      INSERT INTO public.event_alert_history(event_id,alert_id,action,note,created_at) VALUES(NEW.event_id,changed.alert_id,'inactive','Event closed, cancelled, archived or deleted.',stamp);
    END LOOP;
  ELSE
    reason:='report_unavailable';
    FOR changed IN UPDATE public.event_match_alerts SET status='inactive',invalidated_at=stamp,inactive_reason=reason,updated_at=stamp
      WHERE event_id=NEW.event_id AND status='active' AND
        ((missing_report_id=NEW.report_id AND (NEW.withdrawn_at IS NOT NULL OR NEW.released_at IS NOT NULL OR NEW.moderation_status='hidden' OR NEW.reporter_account_id IS NULL OR NEW.reporter_account_id IS DISTINCT FROM OLD.reporter_account_id))
        OR (found_report_id=NEW.report_id AND (NEW.withdrawn_at IS NOT NULL OR NEW.released_at IS NOT NULL OR NEW.moderation_status<>'approved')))
      RETURNING alert_id LOOP
      INSERT INTO public.event_alert_history(event_id,alert_id,action,note,created_at) VALUES(NEW.event_id,changed.alert_id,'inactive','A linked report is no longer available for this alert.',stamp);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_event_alert_event_end AFTER UPDATE OF status,deleted_at ON public.event_workspaces FOR EACH ROW EXECUTE FUNCTION public.event_invalidate_alerts();
CREATE TRIGGER trg_event_alert_report_end AFTER UPDATE OF withdrawn_at,released_at,moderation_status,reporter_account_id ON public.event_reports FOR EACH ROW EXECUTE FUNCTION public.event_invalidate_alerts();

CREATE FUNCTION public.event_send_match_alert(p_event_id UUID,p_actor_id UUID,p_missing_id UUID,p_found_id UUID,p_missing_version INTEGER,p_found_version INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE e public.event_workspaces%ROWTYPE; m public.event_reports%ROWTYPE; f public.event_reports%ROWTYPE; a public.event_match_alerts%ROWTYPE; stamp TIMESTAMPTZ;
BEGIN
  SELECT * INTO e FROM public.event_workspaces WHERE event_id=p_event_id FOR UPDATE;
  stamp:=clock_timestamp();
  IF NOT FOUND OR e.deleted_at IS NOT NULL OR e.status NOT IN ('active','recovery') OR e.portal_enabled IS NOT TRUE OR e.starts_at IS NULL OR e.recovery_ends_at IS NULL OR e.starts_at>stamp OR e.recovery_ends_at<=stamp THEN
    RETURN jsonb_build_object('ok',false,'error','Open event reporting is required before sending a match alert.');
  END IF;
  PERFORM 1 FROM public.user_profiles WHERE account_id=p_actor_id AND is_active IS TRUE AND (suspended_until IS NULL OR suspended_until<=stamp) FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Active manager account required.'); END IF;
  PERFORM 1 FROM public.event_memberships WHERE event_id=p_event_id AND account_id=p_actor_id AND role='manager' AND status='active' AND starts_at<=stamp AND expires_at>stamp FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Current event manager assignment required.'); END IF;
  PERFORM 1 FROM public.event_reports WHERE event_id=p_event_id AND report_id IN(p_missing_id,p_found_id) ORDER BY report_id FOR UPDATE;
  SELECT * INTO m FROM public.event_reports WHERE event_id=p_event_id AND report_id=p_missing_id;
  SELECT * INTO f FROM public.event_reports WHERE event_id=p_event_id AND report_id=p_found_id;
  IF m.kind IS DISTINCT FROM 'missing' OR f.kind IS DISTINCT FROM 'found' OR m.version IS DISTINCT FROM p_missing_version OR f.version IS DISTINCT FROM p_found_version
    OR m.moderation_status NOT IN ('pending','approved') OR f.moderation_status<>'approved' OR f.board_consent IS NOT TRUE
    OR m.withdrawn_at IS NOT NULL OR f.withdrawn_at IS NOT NULL OR m.released_at IS NOT NULL OR f.released_at IS NOT NULL
    OR f.occurred_at<m.occurred_at OR m.reporter_account_id IS NULL OR m.reporter_account_id=f.reporter_account_id
    OR (m.category<>f.category AND m.category<>'Others' AND f.category<>'Others') THEN
    RETURN jsonb_build_object('ok',false,'error','Reports changed or cannot receive an event match alert. Refresh the suggestion.');
  END IF;
  PERFORM 1 FROM public.user_profiles WHERE account_id=m.reporter_account_id AND is_active IS TRUE AND verification_status='verified' AND (suspended_until IS NULL OR suspended_until<=stamp) FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','The report owner must have an active verified account.'); END IF;
  SELECT * INTO a FROM public.event_match_alerts WHERE event_id=p_event_id AND missing_report_id=p_missing_id AND found_report_id=p_found_id;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'alert',to_jsonb(a),'replayed',true); END IF;
  IF EXISTS(SELECT 1 FROM public.event_claims WHERE event_id=p_event_id AND report_id=p_found_id AND claimant_account_id=m.reporter_account_id AND status IN ('pending','approved','released')) THEN
    RETURN jsonb_build_object('ok',false,'error','The owner already has an ownership request for this listing.');
  END IF;
  IF (SELECT count(*) FROM public.event_match_alerts WHERE event_id=p_event_id AND recipient_account_id=m.reporter_account_id AND created_at>=stamp-interval '1 day')>=10
    OR (SELECT count(*) FROM public.event_match_alerts WHERE event_id=p_event_id AND sent_by=p_actor_id AND created_at>=stamp-interval '1 day')>=50 THEN
    RETURN jsonb_build_object('ok',false,'error','Daily event alert limit reached.');
  END IF;
  INSERT INTO public.event_match_alerts(event_id,missing_report_id,found_report_id,recipient_account_id,sent_by,missing_version,found_version,created_at,updated_at)
    VALUES(p_event_id,p_missing_id,p_found_id,m.reporter_account_id,p_actor_id,p_missing_version,p_found_version,stamp,stamp) RETURNING * INTO a;
  INSERT INTO public.event_alert_history(event_id,alert_id,actor_id,action,note,created_at) VALUES(p_event_id,a.alert_id,p_actor_id,'sent','Manager reviewed a possible match and sent a generic event alert.',stamp);
  RETURN jsonb_build_object('ok',true,'alert',to_jsonb(a),'replayed',false);
END $$;

CREATE FUNCTION public.event_alert_action(p_event_id UUID,p_alert_id UUID,p_actor_id UUID,p_action TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE a public.event_match_alerts%ROWTYPE; stamp TIMESTAMPTZ;
BEGIN
  PERFORM 1 FROM public.user_profiles WHERE account_id=p_actor_id AND is_active IS TRUE AND verification_status='verified' AND (suspended_until IS NULL OR suspended_until<=clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Active verified account required.'); END IF;
  SELECT * INTO a FROM public.event_match_alerts WHERE event_id=p_event_id AND alert_id=p_alert_id AND recipient_account_id=p_actor_id FOR UPDATE;
  IF NOT FOUND OR p_action NOT IN ('read','dismiss') OR p_action IS NULL THEN RETURN jsonb_build_object('ok',false,'error','This alert action is unavailable for your account.'); END IF;
  IF (p_action='read' AND a.read_at IS NOT NULL) OR (p_action='dismiss' AND a.dismissed_at IS NOT NULL) THEN RETURN jsonb_build_object('ok',true,'alert',to_jsonb(a),'replayed',true); END IF;
  stamp:=clock_timestamp();
  UPDATE public.event_match_alerts SET read_at=COALESCE(read_at,stamp),dismissed_at=CASE WHEN p_action='dismiss' THEN stamp ELSE dismissed_at END,updated_at=stamp WHERE alert_id=a.alert_id RETURNING * INTO a;
  INSERT INTO public.event_alert_history(event_id,alert_id,actor_id,action,note,created_at) VALUES(p_event_id,a.alert_id,p_actor_id,CASE WHEN p_action='read' THEN 'read' ELSE 'dismissed' END,CASE WHEN p_action='read' THEN 'Recipient opened this event alert.' ELSE 'Recipient moved this alert out of the inbox.' END,stamp);
  RETURN jsonb_build_object('ok',true,'alert',to_jsonb(a),'replayed',false);
END $$;
CREATE FUNCTION public.event_alert_unread_count(p_event_id UUID,p_actor_id UUID) RETURNS BIGINT LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  SELECT count(*) FROM public.event_match_alerts a
  JOIN public.event_workspaces e ON e.event_id=a.event_id
  JOIN public.event_reports m ON m.event_id=a.event_id AND m.report_id=a.missing_report_id
  JOIN public.event_reports f ON f.event_id=a.event_id AND f.report_id=a.found_report_id
  JOIN public.user_profiles u ON u.account_id=a.recipient_account_id
  WHERE a.event_id=p_event_id AND a.recipient_account_id=p_actor_id AND a.status='active' AND a.read_at IS NULL AND a.dismissed_at IS NULL
    AND e.deleted_at IS NULL AND e.status IN ('active','recovery') AND e.portal_enabled IS TRUE AND e.starts_at<=now() AND now()<e.recovery_ends_at
    AND m.reporter_account_id=p_actor_id AND m.kind='missing' AND m.moderation_status IN ('pending','approved') AND m.withdrawn_at IS NULL AND m.released_at IS NULL
    AND f.kind='found' AND f.moderation_status='approved' AND f.board_consent IS TRUE AND f.withdrawn_at IS NULL AND f.released_at IS NULL
    AND u.is_active IS TRUE AND u.verification_status='verified' AND (u.suspended_until IS NULL OR u.suspended_until<=now());
$$;
REVOKE ALL ON FUNCTION public.event_alert_guard(),public.event_invalidate_alerts(),public.event_send_match_alert(UUID,UUID,UUID,UUID,INTEGER,INTEGER),public.event_alert_action(UUID,UUID,UUID,TEXT),public.event_alert_unread_count(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_alert_guard(),public.event_invalidate_alerts(),public.event_send_match_alert(UUID,UUID,UUID,UUID,INTEGER,INTEGER),public.event_alert_action(UUID,UUID,UUID,TEXT),public.event_alert_unread_count(UUID,UUID) TO service_role;
INSERT INTO public.migration_log(name,note) VALUES('20261117_event_match_alerts','Isolated manager-reviewed event notices, recipient acknowledgements, duplicate/availability guards and private history');
COMMIT;
