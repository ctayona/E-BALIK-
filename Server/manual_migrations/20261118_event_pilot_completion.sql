-- USER-RUN ONLY. University pilot: explicit hub consent/publication and closing custody.
-- No campus item/tag/financial rows are created or changed. Apply once after event alerts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.migration_log WHERE name='20261117_event_match_alerts')
    OR to_regclass('public.event_claims') IS NULL OR to_regclass('public.event_match_alerts') IS NULL THEN
    RAISE EXCEPTION 'Apply and verify event recovery and alerts first.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.migration_log WHERE name='20261118_event_pilot_completion')
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN
      ('event_hub_consents','event_hub_publications','event_custody_transfers','event_closure_plans','event_pilot_history'))
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'event_pilot_%') THEN
    RAISE EXCEPTION 'Pilot completion objects already exist. Verify instead of overwriting.';
  END IF;
END $$;
CREATE TABLE public.event_hub_consents (
  consent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_id UUID NOT NULL, report_id UUID NOT NULL,
  account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  allowed BOOLEAN NOT NULL DEFAULT false, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id,report_id), FOREIGN KEY(event_id,report_id) REFERENCES public.event_reports(event_id,report_id) ON DELETE RESTRICT
);
CREATE INDEX idx_event_hub_consent_account ON public.event_hub_consents(account_id);
CREATE TABLE public.event_hub_publications (
  publication_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_id UUID NOT NULL, report_id UUID NOT NULL,
  status VARCHAR(12) NOT NULL CHECK(status IN ('published','withdrawn')), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  report_version INTEGER NOT NULL CHECK(report_version>0), consent_version INTEGER NOT NULL CHECK(consent_version>0),
  listing_snapshot JSONB NOT NULL CHECK(jsonb_typeof(listing_snapshot)='object' AND listing_snapshot ?& ARRAY['kind','category','public_label','venue','occurred_at'] AND listing_snapshot-ARRAY['kind','category','public_label','venue','occurred_at']='{}'::jsonb),
  published_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(), withdrawn_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((status='published' AND withdrawn_at IS NULL) OR (status='withdrawn' AND withdrawn_at IS NOT NULL)),
  UNIQUE(event_id,report_id), FOREIGN KEY(event_id,report_id) REFERENCES public.event_reports(event_id,report_id) ON DELETE RESTRICT
);
CREATE INDEX idx_event_hub_publication_feed ON public.event_hub_publications(published_at DESC,publication_id) WHERE status='published';
CREATE INDEX idx_event_hub_publication_actor ON public.event_hub_publications(published_by);
CREATE TABLE public.event_custody_transfers (
  transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_id UUID NOT NULL, report_id UUID NOT NULL,
  request_id UUID NOT NULL, requested_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  receiver_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  receiver_name VARCHAR(200) NOT NULL, destination VARCHAR(80) NOT NULL DEFAULT 'Lost and Found Office' CHECK(destination='Lost and Found Office'),
  source_location VARCHAR(160) NOT NULL, destination_storage VARCHAR(160),
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','cancelled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), note VARCHAR(1000) NOT NULL CHECK(length(btrim(note)) BETWEEN 5 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), accepted_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id,requested_by,request_id),
  CHECK((status='pending' AND accepted_at IS NULL AND cancelled_at IS NULL AND destination_storage IS NULL)
    OR (status='accepted' AND accepted_at IS NOT NULL AND cancelled_at IS NULL AND destination_storage IS NOT NULL AND length(btrim(destination_storage)) BETWEEN 3 AND 160)
    OR (status='cancelled' AND accepted_at IS NULL AND cancelled_at IS NOT NULL AND destination_storage IS NULL)),
  CHECK(accepted_at IS NULL OR accepted_at>=created_at), CHECK(cancelled_at IS NULL OR cancelled_at>=created_at),
  FOREIGN KEY(event_id,report_id) REFERENCES public.event_reports(event_id,report_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX idx_event_custody_active ON public.event_custody_transfers(event_id,report_id) WHERE status IN ('pending','accepted');
CREATE INDEX idx_event_custody_receiver ON public.event_custody_transfers(receiver_id,status,created_at);
CREATE INDEX idx_event_custody_requester ON public.event_custody_transfers(requested_by);
CREATE INDEX idx_event_custody_report ON public.event_custody_transfers(event_id,report_id,created_at DESC);
CREATE TABLE public.event_closure_plans (
  closure_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_id UUID NOT NULL UNIQUE REFERENCES public.event_workspaces(event_id) ON DELETE RESTRICT,
  instructions VARCHAR(1000) NOT NULL CHECK(length(btrim(instructions)) BETWEEN 5 AND 1000),
  note VARCHAR(1000) NOT NULL CHECK(length(btrim(note)) BETWEEN 5 AND 1000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  completed_at TIMESTAMPTZ, completed_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_event_closure_actor ON public.event_closure_plans(completed_by);
CREATE TABLE public.event_pilot_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_id UUID NOT NULL REFERENCES public.event_workspaces(event_id) ON DELETE RESTRICT,
  report_id UUID, actor_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  action VARCHAR(24) NOT NULL CHECK(action IN ('consent_granted','consent_revoked','hub_published','hub_withdrawn','transfer_requested','transfer_accepted','transfer_cancelled','closure_saved','closure_completed')),
  note VARCHAR(1000) NOT NULL CHECK(length(btrim(note)) BETWEEN 5 AND 1000), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(event_id,report_id) REFERENCES public.event_reports(event_id,report_id) ON DELETE RESTRICT
);
CREATE INDEX idx_event_pilot_history_event ON public.event_pilot_history(event_id,created_at DESC,history_id);
CREATE INDEX idx_event_pilot_history_report ON public.event_pilot_history(event_id,report_id);
CREATE INDEX idx_event_pilot_history_actor ON public.event_pilot_history(actor_id);
ALTER TABLE public.event_hub_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_hub_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_custody_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_closure_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_pilot_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_hub_consents,public.event_hub_publications,public.event_custody_transfers,public.event_closure_plans,public.event_pilot_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.event_hub_consents,public.event_hub_publications,public.event_custody_transfers,public.event_closure_plans TO service_role;
GRANT SELECT,INSERT ON public.event_pilot_history TO service_role;

CREATE FUNCTION public.event_pilot_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_TABLE_NAME='event_closure_plans' THEN
    IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.closure_id IS DISTINCT FROM OLD.closure_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR (OLD.completed_at IS NOT NULL AND (to_jsonb(NEW)-'completed_by') IS DISTINCT FROM (to_jsonb(OLD)-'completed_by'))
      OR (OLD.completed_at IS NOT NULL AND NEW.completed_by IS DISTINCT FROM OLD.completed_by AND NEW.completed_by IS NOT NULL) THEN
      RAISE check_violation USING MESSAGE='Completed closure facts cannot be rewritten.';
    END IF;
  ELSIF TG_TABLE_NAME='event_custody_transfers' THEN
    IF (to_jsonb(NEW)-ARRAY['requested_by','receiver_id','status','version','destination_storage','accepted_at','cancelled_at','updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['requested_by','receiver_id','status','version','destination_storage','accepted_at','cancelled_at','updated_at'])
      OR (NEW.requested_by IS DISTINCT FROM OLD.requested_by AND NEW.requested_by IS NOT NULL)
      OR (NEW.receiver_id IS DISTINCT FROM OLD.receiver_id AND NEW.receiver_id IS NOT NULL)
      OR (OLD.status<>'pending' AND (to_jsonb(NEW)-ARRAY['requested_by','receiver_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['requested_by','receiver_id'])) THEN
      RAISE check_violation USING MESSAGE='Transfer scope and completed custody facts cannot be rewritten.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_event_pilot_transfer_guard BEFORE UPDATE ON public.event_custody_transfers FOR EACH ROW EXECUTE FUNCTION public.event_pilot_guard();
CREATE TRIGGER trg_event_pilot_closure_guard BEFORE UPDATE ON public.event_closure_plans FOR EACH ROW EXECUTE FUNCTION public.event_pilot_guard();

CREATE FUNCTION public.event_pilot_invalidate() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE changed RECORD; eid UUID:=NEW.event_id; rid UUID; stamp TIMESTAMPTZ:=clock_timestamp();
BEGIN
  IF TG_TABLE_NAME='event_workspaces' THEN
    IF NEW.deleted_at IS NULL AND NEW.status NOT IN ('closed','cancelled','archived') THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='event_hub_consents' THEN
    IF NEW.allowed IS TRUE AND NEW.account_id IS NOT NULL THEN RETURN NEW; END IF;
    rid:=NEW.report_id;
  ELSE
    IF NEW.withdrawn_at IS NULL AND NEW.released_at IS NULL AND NEW.moderation_status='approved' AND NEW.reporter_account_id IS NOT NULL
      AND (NEW.public_label,NEW.kind,NEW.category,NEW.venue,NEW.occurred_at,NEW.reporter_account_id) IS NOT DISTINCT FROM
          (OLD.public_label,OLD.kind,OLD.category,OLD.venue,OLD.occurred_at,OLD.reporter_account_id) THEN RETURN NEW; END IF;
    rid:=NEW.report_id;
  END IF;
  FOR changed IN UPDATE public.event_hub_publications SET status='withdrawn',withdrawn_at=stamp,updated_at=stamp,version=version+1
    WHERE event_id=eid AND status='published' AND (rid IS NULL OR report_id=rid) RETURNING report_id LOOP
    INSERT INTO public.event_pilot_history(event_id,report_id,action,note,created_at) VALUES(eid,changed.report_id,'hub_withdrawn','Hub visibility removed because consent, report or event availability changed.',stamp);
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_event_pilot_report_end AFTER UPDATE OF withdrawn_at,released_at,moderation_status,public_label,kind,category,venue,occurred_at,reporter_account_id ON public.event_reports FOR EACH ROW EXECUTE FUNCTION public.event_pilot_invalidate();
CREATE TRIGGER trg_event_pilot_event_end AFTER UPDATE OF status,deleted_at ON public.event_workspaces FOR EACH ROW EXECUTE FUNCTION public.event_pilot_invalidate();
CREATE TRIGGER trg_event_pilot_consent_end AFTER UPDATE OF allowed,account_id ON public.event_hub_consents FOR EACH ROW EXECUTE FUNCTION public.event_pilot_invalidate();

CREATE FUNCTION public.event_pilot_custody_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_TABLE_NAME='event_reports' THEN
    IF NEW.released_at IS NOT NULL AND OLD.released_at IS NULL AND EXISTS(SELECT 1 FROM public.event_custody_transfers WHERE event_id=NEW.event_id AND report_id=NEW.report_id AND status IN ('pending','accepted')) THEN
      RAISE check_violation USING MESSAGE='Closing custody was handed over; the event desk cannot release this item.';
    END IF;
  ELSIF NEW.status IN ('pending','approved') AND EXISTS(SELECT 1 FROM public.event_custody_transfers WHERE event_id=NEW.event_id AND report_id=NEW.report_id AND status IN ('pending','accepted')) THEN
    RAISE check_violation USING MESSAGE='Closing custody handover prevents a new event ownership approval.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_event_pilot_report_custody BEFORE UPDATE OF released_at ON public.event_reports FOR EACH ROW EXECUTE FUNCTION public.event_pilot_custody_guard();
CREATE TRIGGER trg_event_pilot_claim_custody BEFORE INSERT OR UPDATE OF status ON public.event_claims FOR EACH ROW EXECUTE FUNCTION public.event_pilot_custody_guard();

CREATE FUNCTION public.event_pilot_command(p_event_id UUID,p_actor_id UUID,p_action TEXT,p_data JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE e public.event_workspaces%ROWTYPE; r public.event_reports%ROWTYPE; c public.event_hub_consents%ROWTYPE;
  pub public.event_hub_publications%ROWTYPE; t public.event_custody_transfers%ROWTYPE; plan public.event_closure_plans%ROWTYPE;
  actor public.user_profiles%ROWTYPE; receiver public.user_profiles%ROWTYPE;
  stamp TIMESTAMPTZ; memo TEXT; rid UUID; version_num INTEGER; allowed_flag BOOLEAN; final_text TEXT;
BEGIN
  SELECT * INTO e FROM public.event_workspaces WHERE event_id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Event unavailable.'); END IF;
  SELECT * INTO actor FROM public.user_profiles WHERE account_id=p_actor_id FOR SHARE;
  stamp:=clock_timestamp();
  IF NOT FOUND OR actor.is_active IS NOT TRUE OR (actor.suspended_until IS NOT NULL AND actor.suspended_until>stamp) THEN
    RETURN jsonb_build_object('ok',false,'error','Active account required.');
  END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RETURN jsonb_build_object('ok',false,'error','Invalid event operation.'); END IF;
  IF p_action='consent' THEN
    IF p_data-ARRAY['report_id','version','allowed']<>'{}'::jsonb OR jsonb_typeof(p_data->'allowed') IS DISTINCT FROM 'boolean'
      OR actor.verification_status IS DISTINCT FROM 'verified' THEN RETURN jsonb_build_object('ok',false,'error','Verified owner and explicit consent required.'); END IF;
    rid:=(p_data->>'report_id')::uuid; version_num:=(p_data->>'version')::integer; allowed_flag:=(p_data->>'allowed')::boolean;
    SELECT * INTO r FROM public.event_reports WHERE event_id=p_event_id AND report_id=rid FOR UPDATE;
    IF NOT FOUND OR r.reporter_account_id IS DISTINCT FROM p_actor_id THEN RETURN jsonb_build_object('ok',false,'error','Only the report owner controls hub permission.'); END IF;
    IF allowed_flag AND (e.deleted_at IS NOT NULL OR e.status NOT IN ('active','recovery') OR e.portal_enabled IS NOT TRUE OR e.starts_at>stamp OR e.recovery_ends_at<=stamp OR r.withdrawn_at IS NOT NULL OR r.released_at IS NOT NULL) THEN
      RETURN jsonb_build_object('ok',false,'error','Only available reports in an open event can grant hub permission.');
    END IF;
    SELECT * INTO c FROM public.event_hub_consents WHERE event_id=p_event_id AND report_id=rid FOR UPDATE;
    IF COALESCE(c.version,0) IS DISTINCT FROM version_num THEN RETURN jsonb_build_object('ok',false,'error','Hub permission changed. Refresh before saving.'); END IF;
    IF c.consent_id IS NULL THEN
      INSERT INTO public.event_hub_consents(event_id,report_id,account_id,allowed,created_at,updated_at) VALUES(p_event_id,rid,p_actor_id,allowed_flag,stamp,stamp) RETURNING * INTO c;
    ELSIF c.allowed=allowed_flag AND c.account_id=p_actor_id THEN RETURN jsonb_build_object('ok',true,'replayed',true,'version',c.version);
    ELSE UPDATE public.event_hub_consents SET allowed=allowed_flag,version=version+1,updated_at=stamp WHERE consent_id=c.consent_id RETURNING * INTO c;
    END IF;
    INSERT INTO public.event_pilot_history(event_id,report_id,actor_id,action,note,created_at) VALUES(p_event_id,rid,p_actor_id,CASE WHEN allowed_flag THEN 'consent_granted' ELSE 'consent_revoked' END,'Owner changed optional generic visibility on the main E-Balik hub.',stamp);
    RETURN jsonb_build_object('ok',true,'version',c.version);
  END IF;
  IF e.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','Restore this event before operating its records.'); END IF;
  IF p_action='transfer_accept' THEN
    IF actor.access_level IS NULL OR actor.access_level NOT IN ('guard','admin','super_admin') OR p_data-ARRAY['transfer_id','version','storage','identity_checked']<>'{}'::jsonb OR p_data->'identity_checked' IS DISTINCT FROM 'true'::jsonb THEN
      RETURN jsonb_build_object('ok',false,'error','Receiving office staff must verify the physical handover.');
    END IF;
    SELECT * INTO t FROM public.event_custody_transfers WHERE event_id=p_event_id AND transfer_id=(p_data->>'transfer_id')::uuid AND receiver_id=p_actor_id FOR UPDATE;
    IF NOT FOUND OR t.requested_by=p_actor_id THEN RETURN jsonb_build_object('ok',false,'error','This handover is not assigned to you.'); END IF;
    IF t.status='accepted' THEN RETURN jsonb_build_object('ok',true,'replayed',true); END IF;
    final_text:=btrim(p_data->>'storage');
    IF t.status<>'pending' OR t.version IS DISTINCT FROM (p_data->>'version')::integer OR final_text IS NULL OR length(final_text) NOT BETWEEN 3 AND 160 OR final_text ~ '[<>[:cntrl:]]' THEN RETURN jsonb_build_object('ok',false,'error','Refresh the handover and enter its receiving storage position.'); END IF;
    SELECT * INTO r FROM public.event_reports WHERE event_id=p_event_id AND report_id=t.report_id FOR UPDATE;
    IF r.received_at IS NULL OR r.released_at IS NOT NULL OR e.status NOT IN ('closed','cancelled','archived') THEN RETURN jsonb_build_object('ok',false,'error','The original custody record is no longer eligible.'); END IF;
    UPDATE public.event_custody_transfers SET status='accepted',accepted_at=stamp,destination_storage=final_text,version=version+1,updated_at=stamp WHERE transfer_id=t.transfer_id;
    INSERT INTO public.event_pilot_history(event_id,report_id,actor_id,action,note,created_at) VALUES(p_event_id,t.report_id,p_actor_id,'transfer_accepted','Receiving staff verified physical handover into the university Lost and Found Office.',stamp);
    RETURN jsonb_build_object('ok',true);
  END IF;
  IF actor.access_level IS DISTINCT FROM 'super_admin' THEN RETURN jsonb_build_object('ok',false,'error','E-Balik super administrator access required.'); END IF;
  memo:=btrim(p_data->>'note');
  IF memo IS NULL OR length(memo) NOT BETWEEN 5 AND 1000 OR memo ~ '[<>[:cntrl:]]' THEN RETURN jsonb_build_object('ok',false,'error','Use a plain-text reason of 5-1000 characters.'); END IF;
  IF p_action IN ('publish','unpublish') THEN
    IF p_data-ARRAY['report_id','report_version','consent_version','version','note']<>'{}'::jsonb THEN RETURN jsonb_build_object('ok',false,'error','Unexpected publication fields.'); END IF;
    rid:=(p_data->>'report_id')::uuid;
    SELECT * INTO r FROM public.event_reports WHERE event_id=p_event_id AND report_id=rid FOR UPDATE;
    IF NOT FOUND OR r.version IS DISTINCT FROM (p_data->>'report_version')::integer THEN RETURN jsonb_build_object('ok',false,'error','Report changed. Review it again.'); END IF;
    SELECT * INTO pub FROM public.event_hub_publications WHERE event_id=p_event_id AND report_id=rid FOR UPDATE;
    IF COALESCE(pub.version,0) IS DISTINCT FROM (p_data->>'version')::integer THEN RETURN jsonb_build_object('ok',false,'error','Publication changed. Review it again.'); END IF;
    IF p_action='publish' THEN
      SELECT * INTO c FROM public.event_hub_consents WHERE event_id=p_event_id AND report_id=rid FOR SHARE;
      IF c.allowed IS NOT TRUE OR c.account_id IS DISTINCT FROM r.reporter_account_id OR c.version IS DISTINCT FROM (p_data->>'consent_version')::integer
        OR e.status NOT IN ('active','recovery') OR e.portal_enabled IS NOT TRUE OR e.starts_at>stamp OR e.recovery_ends_at<=stamp
        OR r.board_consent IS NOT TRUE OR r.moderation_status<>'approved' OR r.withdrawn_at IS NOT NULL OR r.released_at IS NOT NULL OR r.reporter_account_id IS NULL THEN
        RETURN jsonb_build_object('ok',false,'error','Open event, current owner hub permission and approved available listing required.');
      END IF;
      IF pub.status='published' THEN RETURN jsonb_build_object('ok',true,'replayed',true); END IF;
      IF pub.publication_id IS NULL THEN
        INSERT INTO public.event_hub_publications(event_id,report_id,status,report_version,consent_version,listing_snapshot,published_by,published_at,updated_at) VALUES(p_event_id,rid,'published',r.version,c.version,jsonb_build_object('kind',r.kind,'category',r.category,'public_label',r.public_label,'venue',r.venue,'occurred_at',r.occurred_at),p_actor_id,stamp,stamp);
      ELSE UPDATE public.event_hub_publications SET status='published',report_version=r.version,consent_version=c.version,listing_snapshot=jsonb_build_object('kind',r.kind,'category',r.category,'public_label',r.public_label,'venue',r.venue,'occurred_at',r.occurred_at),published_by=p_actor_id,published_at=stamp,withdrawn_at=NULL,updated_at=stamp,version=version+1 WHERE publication_id=pub.publication_id;
      END IF;
    ELSE
      IF pub.publication_id IS NULL OR pub.status='withdrawn' THEN RETURN jsonb_build_object('ok',true,'replayed',true); END IF;
      UPDATE public.event_hub_publications SET status='withdrawn',withdrawn_at=stamp,updated_at=stamp,version=version+1 WHERE publication_id=pub.publication_id;
    END IF;
    INSERT INTO public.event_pilot_history(event_id,report_id,actor_id,action,note,created_at) VALUES(p_event_id,rid,p_actor_id,CASE WHEN p_action='publish' THEN 'hub_published' ELSE 'hub_withdrawn' END,memo,stamp);
    RETURN jsonb_build_object('ok',true);
  END IF;
  SELECT * INTO plan FROM public.event_closure_plans WHERE event_id=p_event_id FOR UPDATE;
  IF plan.completed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','Closure is already signed off and preserved.'); END IF;
  IF p_action IN ('closure_save','closure_complete') THEN
    IF p_data-ARRAY['version','instructions','note','acknowledged']<>'{}'::jsonb OR COALESCE(plan.version,0) IS DISTINCT FROM (p_data->>'version')::integer THEN RETURN jsonb_build_object('ok',false,'error','Closing instructions changed. Refresh first.'); END IF;
    final_text:=btrim(p_data->>'instructions');
    IF final_text IS NULL OR length(final_text) NOT BETWEEN 5 AND 1000 OR final_text ~ '[<>@[:cntrl:]]|[0-9]{6,}' THEN RETURN jsonb_build_object('ok',false,'error','Use generic final desk instructions without private codes, contact details or identifying numbers.'); END IF;
    IF p_action='closure_complete' AND (e.status NOT IN ('closed','cancelled','archived') OR p_data->'acknowledged' IS DISTINCT FROM 'true'::jsonb
      OR EXISTS(SELECT 1 FROM public.event_custody_transfers WHERE event_id=p_event_id AND status='pending')
      OR EXISTS(SELECT 1 FROM public.event_reports er WHERE er.event_id=p_event_id AND er.received_at IS NOT NULL AND er.released_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.event_custody_transfers ct WHERE ct.event_id=er.event_id AND ct.report_id=er.report_id AND ct.status='accepted'))
      OR EXISTS(SELECT 1 FROM public.event_claims WHERE event_id=p_event_id AND status IN ('pending','approved'))) THEN
      RETURN jsonb_build_object('ok',false,'error','Close the event, resolve open claims and obtain receipt for every remaining custody item before signoff.');
    END IF;
    IF plan.closure_id IS NULL THEN
      INSERT INTO public.event_closure_plans(event_id,instructions,note,completed_at,completed_by,created_at,updated_at) VALUES(p_event_id,final_text,memo,CASE WHEN p_action='closure_complete' THEN stamp END,CASE WHEN p_action='closure_complete' THEN p_actor_id END,stamp,stamp);
    ELSE UPDATE public.event_closure_plans SET instructions=final_text,note=memo,version=version+1,updated_at=stamp,completed_at=CASE WHEN p_action='closure_complete' THEN stamp END,completed_by=CASE WHEN p_action='closure_complete' THEN p_actor_id END WHERE closure_id=plan.closure_id;
    END IF;
    INSERT INTO public.event_pilot_history(event_id,actor_id,action,note,created_at) VALUES(p_event_id,p_actor_id,CASE WHEN p_action='closure_complete' THEN 'closure_completed' ELSE 'closure_saved' END,memo,stamp);
    RETURN jsonb_build_object('ok',true);
  ELSIF p_action='transfer_request' THEN
    IF p_data-ARRAY['report_id','report_version','receiver_id','request_id','note']<>'{}'::jsonb OR e.status NOT IN ('closed','cancelled','archived') THEN RETURN jsonb_build_object('ok',false,'error','Close this event before its final custody handover.'); END IF;
    rid:=(p_data->>'report_id')::uuid;
    SELECT * INTO t FROM public.event_custody_transfers WHERE event_id=p_event_id AND requested_by=p_actor_id AND request_id=(p_data->>'request_id')::uuid;
    IF FOUND THEN
      IF t.report_id IS DISTINCT FROM rid OR t.receiver_id IS DISTINCT FROM (p_data->>'receiver_id')::uuid THEN RETURN jsonb_build_object('ok',false,'error','Handover request reference already used.'); END IF;
      RETURN jsonb_build_object('ok',true,'replayed',true);
    END IF;
    SELECT * INTO r FROM public.event_reports WHERE event_id=p_event_id AND report_id=rid FOR UPDATE;
    IF NOT FOUND OR r.version IS DISTINCT FROM (p_data->>'report_version')::integer OR r.kind<>'found' OR r.received_at IS NULL OR r.released_at IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.event_custody_transfers WHERE event_id=p_event_id AND report_id=rid AND status IN ('pending','accepted'))
      OR EXISTS(SELECT 1 FROM public.event_claims WHERE event_id=p_event_id AND report_id=rid AND status IN ('pending','approved')) THEN RETURN jsonb_build_object('ok',false,'error','Review an unresolved received item without an existing handover or open claim.'); END IF;
    SELECT * INTO receiver FROM public.user_profiles WHERE account_id=(p_data->>'receiver_id')::uuid FOR SHARE;
    IF NOT FOUND OR receiver.account_id=p_actor_id OR receiver.is_active IS NOT TRUE OR receiver.access_level IS NULL OR receiver.access_level NOT IN ('guard','admin','super_admin') OR (receiver.suspended_until IS NOT NULL AND receiver.suspended_until>stamp) THEN RETURN jsonb_build_object('ok',false,'error','Choose a different active university office staff account.'); END IF;
    INSERT INTO public.event_custody_transfers(event_id,report_id,request_id,requested_by,receiver_id,receiver_name,source_location,note,created_at,updated_at)
      VALUES(p_event_id,rid,(p_data->>'request_id')::uuid,p_actor_id,receiver.account_id,left(COALESCE(NULLIF(btrim(COALESCE(receiver.fname,'')||' '||COALESCE(receiver.lname,'')),''),'Office staff'),200),r.storage_location,memo,stamp,stamp);
    INSERT INTO public.event_pilot_history(event_id,report_id,actor_id,action,note,created_at) VALUES(p_event_id,rid,p_actor_id,'transfer_requested',memo,stamp);
    RETURN jsonb_build_object('ok',true);
  ELSIF p_action='transfer_cancel' THEN
    IF p_data-ARRAY['transfer_id','version','note']<>'{}'::jsonb THEN RETURN jsonb_build_object('ok',false,'error','Unexpected cancellation fields.'); END IF;
    SELECT * INTO t FROM public.event_custody_transfers WHERE event_id=p_event_id AND transfer_id=(p_data->>'transfer_id')::uuid FOR UPDATE;
    IF NOT FOUND OR t.version IS DISTINCT FROM (p_data->>'version')::integer OR t.status<>'pending' THEN RETURN jsonb_build_object('ok',false,'error','Only a current pending handover can be cancelled.'); END IF;
    UPDATE public.event_custody_transfers SET status='cancelled',cancelled_at=stamp,updated_at=stamp,version=version+1 WHERE transfer_id=t.transfer_id;
    INSERT INTO public.event_pilot_history(event_id,report_id,actor_id,action,note,created_at) VALUES(p_event_id,t.report_id,p_actor_id,'transfer_cancelled',memo,stamp);
    RETURN jsonb_build_object('ok',true);
  END IF;
  RETURN jsonb_build_object('ok',false,'error','Unsupported pilot operation.');
EXCEPTION WHEN unique_violation OR invalid_text_representation OR not_null_violation OR check_violation OR string_data_right_truncation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('ok',false,'error','Event operation conflicts with current records. Refresh and review before retrying.');
END $$;

CREATE FUNCTION public.event_pilot_feed(p_actor_id UUID,p_offset INTEGER,p_kind TEXT,p_search TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  WITH eligible AS (
    SELECT p.publication_id,p.published_at,e.event_id,e.name event_name,e.slug,r.report_id,r.kind,r.category,r.public_label,r.venue,r.occurred_at,r.received_at,r.created_at
    FROM public.event_hub_publications p JOIN public.event_reports r ON (r.event_id,r.report_id)=(p.event_id,p.report_id)
    JOIN public.event_workspaces e ON e.event_id=p.event_id
    JOIN public.event_hub_consents c ON (c.event_id,c.report_id)=(p.event_id,p.report_id)
    WHERE p.status='published' AND c.allowed IS TRUE AND c.account_id=r.reporter_account_id AND r.reporter_account_id IS NOT NULL AND p.consent_version=c.version
      AND p.listing_snapshot=jsonb_build_object('kind',r.kind,'category',r.category,'public_label',r.public_label,'venue',r.venue,'occurred_at',r.occurred_at)
      AND r.moderation_status='approved' AND r.board_consent IS TRUE AND r.withdrawn_at IS NULL AND r.released_at IS NULL
      AND e.deleted_at IS NULL AND e.status IN ('active','recovery') AND e.portal_enabled IS TRUE AND e.starts_at<=now() AND now()<e.recovery_ends_at
      AND (p_kind='all' OR r.kind=p_kind) AND (COALESCE(p_search,'')='' OR strpos(lower(r.public_label||' '||r.category||' '||r.venue||' '||e.name),lower(p_search))>0)
      AND p_offset BETWEEN 0 AND 100000 AND p_kind IN ('all','missing','found') AND length(COALESCE(p_search,''))<=100
      AND EXISTS(SELECT 1 FROM public.user_profiles WHERE account_id=p_actor_id AND is_active IS TRUE AND verification_status='verified' AND (suspended_until IS NULL OR suspended_until<=now()))
    ORDER BY p.published_at DESC,p.publication_id OFFSET p_offset LIMIT 25
  ) SELECT jsonb_build_object('publications',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM eligible ORDER BY published_at DESC,publication_id LIMIT 24) x),'[]'::jsonb),'has_more',(SELECT count(*)>24 FROM eligible));
$$;

CREATE FUNCTION public.event_pilot_snapshot(p_event_id UUID,p_actor_id UUID,p_offset INTEGER,p_limit INTEGER,p_filter TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  WITH authorized AS (
    SELECT e.* FROM public.event_workspaces e JOIN public.user_profiles u ON u.account_id=p_actor_id
    WHERE e.event_id=p_event_id AND u.is_active IS TRUE AND (u.suspended_until IS NULL OR u.suspended_until<=now())
      AND (u.access_level='super_admin' OR (e.deleted_at IS NULL AND e.status IN ('scheduled','active','recovery') AND now()<e.recovery_ends_at AND EXISTS
        (SELECT 1 FROM public.event_memberships m WHERE m.event_id=e.event_id AND m.account_id=u.account_id AND m.role='manager' AND m.status='active' AND m.starts_at<=now() AND now()<m.expires_at)))
      AND p_offset BETWEEN 0 AND 100000 AND p_limit BETWEEN 1 AND 5001 AND p_filter IN ('all','unresolved','custody')
  ), register AS (
    SELECT r.report_id,r.kind,r.item_name,r.public_label,r.category,r.venue,r.occurred_at,r.received_at,r.released_at,r.withdrawn_at,r.moderation_status,r.storage_location,r.version,
      t.transfer_id,t.status transfer_status,t.version transfer_version,t.receiver_name,t.destination,t.destination_storage,t.accepted_at,
      COALESCE(c.allowed AND c.account_id=r.reporter_account_id,false) hub_allowed,COALESCE(c.version,0) consent_version,
      p.status publication_status,COALESCE(p.version,0) publication_version
    FROM public.event_reports r JOIN authorized e ON e.event_id=r.event_id
    LEFT JOIN public.event_hub_consents c ON (c.event_id,c.report_id)=(r.event_id,r.report_id)
    LEFT JOIN public.event_hub_publications p ON (p.event_id,p.report_id)=(r.event_id,r.report_id)
    LEFT JOIN public.event_custody_transfers t ON (t.event_id,t.report_id)=(r.event_id,r.report_id) AND t.status IN ('pending','accepted')
  ), filtered AS (
    SELECT * FROM register WHERE p_filter='all' OR (p_filter='unresolved' AND withdrawn_at IS NULL AND released_at IS NULL AND moderation_status<>'hidden')
      OR (p_filter='custody' AND received_at IS NOT NULL AND released_at IS NULL)
    ORDER BY report_id OFFSET p_offset LIMIT p_limit
  ) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM authorized) THEN jsonb_build_object('ok',false,'error','Manager or super administrator access required.') ELSE jsonb_build_object(
    'ok',true,'generated_at',now(),'counts',(SELECT jsonb_build_object('reports',count(*),'missing',count(*) FILTER(WHERE kind='missing'),'found',count(*) FILTER(WHERE kind='found'),
      'received',count(*) FILTER(WHERE received_at IS NOT NULL),'released',count(*) FILTER(WHERE released_at IS NOT NULL),
      'unresolved',count(*) FILTER(WHERE withdrawn_at IS NULL AND released_at IS NULL AND moderation_status<>'hidden'),
      'desk_custody',count(*) FILTER(WHERE received_at IS NOT NULL AND released_at IS NULL AND transfer_status IS DISTINCT FROM 'accepted'),
      'pending_transfers',count(*) FILTER(WHERE transfer_status='pending'),'transferred',count(*) FILTER(WHERE transfer_status='accepted'),
      'hub_published',count(*) FILTER(WHERE publication_status='published' AND hub_allowed)) FROM register),
    'claims',(SELECT jsonb_build_object('total',count(*),'open',count(*) FILTER(WHERE status IN ('pending','approved')),'released',count(*) FILTER(WHERE status='released')) FROM public.event_claims WHERE event_id=p_event_id),
    'closure',(SELECT to_jsonb(cp)-ARRAY['completed_by','created_at','updated_at'] FROM public.event_closure_plans cp WHERE event_id=p_event_id),
    'reports',COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM filtered f),'[]'::jsonb),
    'history',COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM (SELECT history_id,report_id,action,note,created_at FROM public.event_pilot_history WHERE event_id=p_event_id ORDER BY created_at DESC,history_id LIMIT 50) h),'[]'::jsonb)
  ) END;
$$;
REVOKE ALL ON FUNCTION public.event_pilot_guard(),public.event_pilot_invalidate(),public.event_pilot_custody_guard(),public.event_pilot_command(UUID,UUID,TEXT,JSONB),public.event_pilot_feed(UUID,INTEGER,TEXT,TEXT),public.event_pilot_snapshot(UUID,UUID,INTEGER,INTEGER,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_pilot_guard(),public.event_pilot_invalidate(),public.event_pilot_custody_guard(),public.event_pilot_command(UUID,UUID,TEXT,JSONB),public.event_pilot_feed(UUID,INTEGER,TEXT,TEXT),public.event_pilot_snapshot(UUID,UUID,INTEGER,INTEGER,TEXT) TO service_role;
INSERT INTO public.migration_log(name,note) VALUES('20261118_event_pilot_completion','University pilot: separate owner hub consent, explicit safe publication, closing summaries and acknowledged office custody handovers');
COMMIT;
