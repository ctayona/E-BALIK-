-- USER-RUN ONLY. Additive event report/intake slice; no campus report or claim changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.migration_log WHERE name='20261116_event_lifecycle') THEN
    RAISE EXCEPTION 'Apply the event lifecycle migration first.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.migration_log WHERE name='20261116b_event_reports')
    OR to_regclass('public.event_reports') IS NOT NULL OR to_regclass('public.event_report_history') IS NOT NULL
    OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='event_workspaces' AND column_name='portal_enabled')
    OR EXISTS(SELECT 1 FROM storage.buckets WHERE id='event-report-images')
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('event_report_command','event_set_portal')) THEN
    RAISE EXCEPTION 'Event report objects already exist. Verify installation instead of overwriting.';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND roles && ARRAY['public','anon','authenticated']::name[]) THEN
    RAISE EXCEPTION 'Browser Storage policies require review before adding private report images.';
  END IF;
END $$;
ALTER TABLE public.event_workspaces ADD COLUMN portal_enabled BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE public.event_reports (
  report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.event_workspaces(event_id) ON DELETE RESTRICT,
  reporter_account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  request_id UUID NOT NULL,
  board_consent BOOLEAN NOT NULL DEFAULT false,
  kind VARCHAR(10) NOT NULL CHECK(kind IN ('missing','found')),
  item_name VARCHAR(120) NOT NULL CHECK(length(btrim(item_name)) BETWEEN 3 AND 120),
  category VARCHAR(40) NOT NULL CHECK(category IN ('Bags & Luggage','Electronics','Accessories','Personal Effects','Documents & Cards','Clothing','Keys','Valuables','Others')),
  description VARCHAR(2000) NOT NULL CHECK(length(btrim(description)) BETWEEN 10 AND 2000),
  venue VARCHAR(80) NOT NULL CHECK(venue IN ('Library','Gymnasium','Cafeteria','Admin Building','Oval Track','Engineering Building','Lost and Found Office')),
  location_details VARCHAR(300) NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL,
  photo_path VARCHAR(255),
  moderation_status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK(moderation_status IN ('pending','approved','hidden')),
  public_label VARCHAR(120),
  withdrawn_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  received_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  storage_location VARCHAR(160),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id,report_id),
  UNIQUE(event_id,reporter_account_id,request_id),
  CHECK(photo_path IS NULL OR photo_path ~ ('^'||event_id::text||'/'||report_id::text||'/[0-9a-f]{32}\.webp$')),
  CHECK(moderation_status<>'approved' OR (public_label IS NOT NULL AND length(btrim(public_label)) BETWEEN 3 AND 120)),
  CHECK(moderation_status<>'approved' OR board_consent IS TRUE),
  CHECK((received_at IS NULL AND received_by IS NULL AND storage_location IS NULL)
    OR (kind='found' AND received_at IS NOT NULL AND storage_location IS NOT NULL AND length(btrim(storage_location)) BETWEEN 3 AND 160)),
  CHECK(withdrawn_at IS NULL OR received_at IS NULL)
);
CREATE INDEX idx_event_reports_queue ON public.event_reports(event_id,created_at DESC,report_id);
CREATE INDEX idx_event_reports_owner ON public.event_reports(reporter_account_id,event_id,created_at DESC);
CREATE INDEX idx_event_reports_board ON public.event_reports(event_id,created_at DESC) WHERE moderation_status='approved' AND withdrawn_at IS NULL;
CREATE INDEX idx_event_reports_receiver ON public.event_reports(received_by);
CREATE TABLE public.event_report_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  report_id UUID NOT NULL,
  actor_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  action VARCHAR(12) NOT NULL CHECK(action IN ('created','approved','hidden','received','note','withdrawn')),
  note VARCHAR(1000) NOT NULL CHECK(length(btrim(note)) BETWEEN 5 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(event_id,report_id) REFERENCES public.event_reports(event_id,report_id) ON DELETE RESTRICT
);
CREATE INDEX idx_event_report_history_report ON public.event_report_history(event_id,report_id,created_at DESC);
CREATE INDEX idx_event_report_history_actor ON public.event_report_history(actor_id);
ALTER TABLE public.event_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_report_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_reports,public.event_report_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.event_reports TO service_role;
GRANT SELECT,INSERT ON public.event_report_history TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('event-report-images','event-report-images',false,5242880,ARRAY['image/webp']);

CREATE FUNCTION public.event_set_portal(p_event_id UUID,p_actor_id UUID,p_version INTEGER,p_enabled BOOLEAN,p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE e public.event_workspaces%ROWTYPE; stamp TIMESTAMPTZ;
BEGIN
  PERFORM 1 FROM public.user_profiles WHERE account_id=p_actor_id AND is_active IS TRUE AND access_level='super_admin'
    AND (suspended_until IS NULL OR suspended_until<=clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Active super administrator required.'); END IF;
  SELECT * INTO e FROM public.event_workspaces WHERE event_id=p_event_id FOR UPDATE;
  stamp:=clock_timestamp();
  IF NOT FOUND OR e.version IS DISTINCT FROM p_version OR p_enabled IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','Event changed or was not found. Refresh before continuing.');
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 5 AND 1000 OR p_note ~ '[<>[:cntrl:]]' THEN
    RETURN jsonb_build_object('ok',false,'error','A plain-text reason of 5-1000 characters is required.');
  END IF;
  IF p_enabled AND (e.status NOT IN ('active','recovery') OR e.starts_at IS NULL OR e.recovery_ends_at IS NULL OR e.starts_at>stamp OR e.recovery_ends_at<=stamp) THEN
    RETURN jsonb_build_object('ok',false,'error','Start the event within its recovery period before opening the portal.');
  END IF;
  IF p_enabled AND NOT EXISTS(SELECT 1 FROM public.event_memberships m JOIN public.user_profiles u USING(account_id)
    WHERE m.event_id=p_event_id AND m.role='manager' AND m.status='active' AND m.starts_at<=stamp AND m.expires_at>=e.recovery_ends_at
      AND m.expires_at>stamp AND u.is_active IS TRUE AND (u.suspended_until IS NULL OR u.suspended_until<=stamp)) THEN
    RETURN jsonb_build_object('ok',false,'error','Assign an active manager through final claiming before opening the portal.');
  END IF;
  IF e.portal_enabled=p_enabled THEN RETURN jsonb_build_object('ok',false,'error','Portal already has this setting. Refresh.'); END IF;
  UPDATE public.event_workspaces SET portal_enabled=p_enabled,version=version+1,updated_at=stamp WHERE event_id=p_event_id RETURNING * INTO e;
  INSERT INTO public.event_state_history(event_id,actor_id,from_status,to_status,note,created_at)
  VALUES(p_event_id,p_actor_id,e.status,e.status,(CASE WHEN p_enabled THEN 'Portal opened: ' ELSE 'Portal paused: ' END)||left(btrim(p_note),980),stamp);
  RETURN jsonb_build_object('ok',true,'event',to_jsonb(e));
END $$;

CREATE FUNCTION public.event_report_command(p_event_id UUID,p_actor_id UUID,p_report_id UUID,p_action TEXT,p_version INTEGER,p_data JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE e public.event_workspaces%ROWTYPE; r public.event_reports%ROWTYPE; u public.user_profiles%ROWTYPE;
  m public.event_memberships%ROWTYPE; staff BOOLEAN:=false; stamp TIMESTAMPTZ; incident TIMESTAMPTZ; request_key UUID; memo TEXT;
BEGIN
  -- Event lock serializes intake/creation and lifecycle changes. Fresh account/membership locks prevent revoked writes.
  SELECT * INTO e FROM public.event_workspaces WHERE event_id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Event not found.'); END IF;
  SELECT * INTO u FROM public.user_profiles WHERE account_id=p_actor_id FOR SHARE;
  stamp:=clock_timestamp();
  IF NOT FOUND OR u.is_active IS NOT TRUE OR (u.suspended_until IS NOT NULL AND u.suspended_until>stamp) THEN
    RETURN jsonb_build_object('ok',false,'error','Active account required.');
  END IF;
  SELECT * INTO m FROM public.event_memberships WHERE event_id=p_event_id AND account_id=p_actor_id FOR SHARE;
  staff:=FOUND AND m.status='active' AND m.role IN ('manager','desk_staff') AND m.starts_at<=stamp AND stamp<m.expires_at;
  IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RETURN jsonb_build_object('ok',false,'error','Invalid report payload.'); END IF;
  IF p_action='create' THEN
    IF NOT staff AND u.verification_status IS DISTINCT FROM 'verified' THEN
      RETURN jsonb_build_object('ok',false,'error','Verify your E-Balik account before reporting.');
    END IF;
    IF p_data - ARRAY['request_id','board_consent','kind','item_name','category','description','venue','location_details','occurred_at','photo_path'] <> '{}'::jsonb OR p_data->'board_consent' IS DISTINCT FROM 'true'::jsonb THEN
      RETURN jsonb_build_object('ok',false,'error','Unexpected report fields.');
    END IF;
    request_key:=(p_data->>'request_id')::uuid;
    IF request_key IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Report request reference required.'); END IF;
    SELECT * INTO r FROM public.event_reports WHERE event_id=p_event_id AND reporter_account_id=p_actor_id AND request_id=request_key;
    IF FOUND THEN RETURN jsonb_build_object('ok',true,'report',to_jsonb(r),'replayed',true); END IF;
    IF (e.portal_enabled IS NOT TRUE AND staff IS NOT TRUE) OR e.status NOT IN ('active','recovery') OR e.starts_at IS NULL OR e.ends_at IS NULL OR e.recovery_ends_at IS NULL OR e.starts_at>stamp OR e.recovery_ends_at<=stamp THEN
      RETURN jsonb_build_object('ok',false,'error','Event reporting is closed.');
    END IF;
    incident:=(p_data->>'occurred_at')::timestamptz;
    IF incident IS NULL OR incident<e.starts_at OR incident>LEAST(stamp,e.ends_at) THEN
      RETURN jsonb_build_object('ok',false,'error','The incident must occur during the event and cannot be in the future.');
    END IF;
    IF (SELECT count(*) FROM public.event_reports WHERE event_id=p_event_id AND reporter_account_id=p_actor_id AND created_at>=stamp-interval '1 day')>=25 THEN
      RETURN jsonb_build_object('ok',false,'error','Daily event report limit reached. Contact the collection desk.');
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_each(p_data) kv WHERE kv.key<>'board_consent' AND kv.value<>'null'::jsonb AND jsonb_typeof(kv.value)<>'string')
      OR EXISTS(SELECT 1 FROM jsonb_each_text(p_data) kv WHERE kv.value ~ '[<>[:cntrl:]]') THEN
      RETURN jsonb_build_object('ok',false,'error','Use plain text report fields.');
    END IF;
    INSERT INTO public.event_reports(report_id,event_id,reporter_account_id,request_id,board_consent,kind,item_name,category,description,venue,location_details,occurred_at,photo_path,created_at,updated_at)
    VALUES(p_report_id,p_event_id,p_actor_id,request_key,true,p_data->>'kind',btrim(p_data->>'item_name'),p_data->>'category',btrim(p_data->>'description'),p_data->>'venue',COALESCE(btrim(p_data->>'location_details'),''),incident,p_data->>'photo_path',stamp,stamp) RETURNING * INTO r;
    INSERT INTO public.event_report_history(event_id,report_id,actor_id,action,note,created_at) VALUES(p_event_id,r.report_id,p_actor_id,'created','Report submitted for event review.',stamp);
    RETURN jsonb_build_object('ok',true,'report',to_jsonb(r),'replayed',false);
  END IF;
  IF e.status NOT IN ('active','recovery') OR e.starts_at IS NULL OR e.recovery_ends_at IS NULL OR e.starts_at>stamp OR e.recovery_ends_at<=stamp THEN
    RETURN jsonb_build_object('ok',false,'error','Event desk writes are closed.');
  END IF;
  SELECT * INTO r FROM public.event_reports WHERE event_id=p_event_id AND report_id=p_report_id FOR UPDATE;
  IF NOT FOUND OR r.version IS DISTINCT FROM p_version THEN RETURN jsonb_build_object('ok',false,'error','Report changed or was not found. Refresh before continuing.'); END IF;
  IF p_action='withdraw' THEN
    IF r.reporter_account_id IS DISTINCT FROM p_actor_id OR r.received_at IS NOT NULL OR r.withdrawn_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'error','Only your own report without desk custody can be withdrawn.');
    END IF;
    IF p_data<>'{}'::jsonb THEN RETURN jsonb_build_object('ok',false,'error','Unexpected withdrawal fields.'); END IF;
    UPDATE public.event_reports SET withdrawn_at=stamp,version=version+1,updated_at=stamp WHERE report_id=r.report_id RETURNING * INTO r;
    memo:='Reporter withdrew the report.';
  ELSE
    IF staff IS NOT TRUE OR r.withdrawn_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','Current event staff assignment required.'); END IF;
    memo:=btrim(p_data->>'note');
    IF memo IS NULL OR length(memo) NOT BETWEEN 5 AND 1000 OR memo ~ '[<>[:cntrl:]]' THEN RETURN jsonb_build_object('ok',false,'error','Enter a plain-text note of 5-1000 characters.'); END IF;
    IF p_action IN ('approve','hide') THEN
      IF m.role<>'manager' OR p_data - ARRAY['note','public_label'] <> '{}'::jsonb THEN RETURN jsonb_build_object('ok',false,'error','Only event managers can review publication.'); END IF;
      IF p_action='approve' AND (r.board_consent IS NOT TRUE OR p_data->>'public_label' IS NULL OR length(btrim(p_data->>'public_label')) NOT BETWEEN 3 AND 120 OR p_data->>'public_label' ~ '[<>@[:cntrl:]]|[0-9]{6,}') THEN
        RETURN jsonb_build_object('ok',false,'error','Enter a generic display label without contact details or identification numbers.');
      END IF;
      UPDATE public.event_reports SET moderation_status=CASE WHEN p_action='approve' THEN 'approved' ELSE 'hidden' END,
        public_label=CASE WHEN p_action='approve' THEN btrim(p_data->>'public_label') ELSE public_label END,version=version+1,updated_at=stamp WHERE report_id=r.report_id RETURNING * INTO r;
    ELSIF p_action='receive' THEN
      IF p_data - ARRAY['note','storage_location'] <> '{}'::jsonb OR r.kind<>'found' OR r.received_at IS NOT NULL
        OR p_data->>'storage_location' IS NULL OR length(btrim(p_data->>'storage_location')) NOT BETWEEN 3 AND 160 OR p_data->>'storage_location' ~ '[<>[:cntrl:]]' THEN
        RETURN jsonb_build_object('ok',false,'error','Physical receipt requires an unreceived found item and its storage position.');
      END IF;
      UPDATE public.event_reports SET received_at=stamp,received_by=p_actor_id,storage_location=btrim(p_data->>'storage_location'),version=version+1,updated_at=stamp WHERE report_id=r.report_id RETURNING * INTO r;
    ELSIF p_action='note' AND p_data - ARRAY['note'] = '{}'::jsonb THEN
      UPDATE public.event_reports SET version=version+1,updated_at=stamp WHERE report_id=r.report_id RETURNING * INTO r;
    ELSE RETURN jsonb_build_object('ok',false,'error','Unsupported event action.');
    END IF;
  END IF;
  INSERT INTO public.event_report_history(event_id,report_id,actor_id,action,note,created_at)
  VALUES(p_event_id,r.report_id,p_actor_id,CASE p_action WHEN 'approve' THEN 'approved' WHEN 'hide' THEN 'hidden' WHEN 'receive' THEN 'received' WHEN 'withdraw' THEN 'withdrawn' ELSE 'note' END,memo,stamp);
  RETURN jsonb_build_object('ok',true,'report',to_jsonb(r));
EXCEPTION WHEN invalid_text_representation OR not_null_violation OR check_violation OR string_data_right_truncation OR datetime_field_overflow THEN
  RETURN jsonb_build_object('ok',false,'error','Invalid event report fields. Check the form and try again.');
END $$;
REVOKE ALL ON FUNCTION public.event_set_portal(UUID,UUID,INTEGER,BOOLEAN,TEXT), public.event_report_command(UUID,UUID,UUID,TEXT,INTEGER,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_set_portal(UUID,UUID,INTEGER,BOOLEAN,TEXT), public.event_report_command(UUID,UUID,UUID,TEXT,INTEGER,JSONB) TO service_role;
INSERT INTO public.migration_log(name,note) VALUES('20261116b_event_reports','Isolated event reports, private images, moderated event board and audited desk intake; portal defaults closed');
COMMIT;
