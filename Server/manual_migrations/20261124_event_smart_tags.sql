-- University event storage pilot. User-applied, additive and transactional.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$ DECLARE obj text; recorded boolean; BEGIN
 SELECT EXISTS(SELECT FROM public.migration_log WHERE name='20261124_event_smart_tags') INTO recorded;
 FOREACH obj IN ARRAY ARRAY['event_tag_batches','event_tags','event_tag_desks','event_tag_allocations','event_tag_registrations','event_tag_transfers','event_tag_history'] LOOP
  IF (to_regclass('public.'||obj) IS NOT NULL) IS DISTINCT FROM recorded THEN
   RAISE EXCEPTION 'Unexpected existing or missing pilot object %. Inspect before applying',obj;
  END IF;
 END LOOP;
 IF NOT EXISTS (SELECT FROM public.migration_log WHERE name='20261118_event_pilot_completion')
 OR NOT EXISTS (SELECT FROM public.migration_log WHERE name='20261123_campus_venues')
 OR NOT EXISTS (SELECT FROM storage.buckets WHERE id='event-report-images' AND public=false)
 THEN RAISE EXCEPTION 'Install event pilot and venues, and verify private event-report-images first'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.event_tag_batches (
 batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label varchar(80) NOT NULL,
 created_by uuid REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.event_tags (
 code uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES public.event_tag_batches,
 disabled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_tag_physical_label ON public.event_tags(left(code::text,8));
CREATE INDEX IF NOT EXISTS idx_event_tags_batch ON public.event_tags(batch_id,code);
CREATE TABLE IF NOT EXISTS public.event_tag_desks (
 event_id uuid PRIMARY KEY REFERENCES public.event_workspaces, enabled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS public.event_tag_allocations (
 allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code uuid NOT NULL REFERENCES public.event_tags,
 event_id uuid NOT NULL REFERENCES public.event_workspaces, assigned_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz, UNIQUE(allocation_id,event_id,code)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_tag_allocation_open ON public.event_tag_allocations(code) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_tag_alloc_event ON public.event_tag_allocations(event_id,code);
CREATE TABLE IF NOT EXISTS public.event_tag_registrations (
 registration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), allocation_id uuid NOT NULL, event_id uuid NOT NULL,
 code uuid NOT NULL, owner_id uuid REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
 CHECK(owner_id IS NOT NULL OR status IN ('cancelled','collected')),
 event_name varchar(120) NOT NULL, item_name varchar(100) NOT NULL CHECK(length(trim(item_name))>=3),
 description varchar(500) NOT NULL CHECK(length(trim(description))>=1), photo_path text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','held','office','collected','cancelled')),
 version integer NOT NULL DEFAULT 1, storage_position varchar(160), received_at timestamptz,
 received_by uuid REFERENCES public.user_profiles ON DELETE SET NULL, released_at timestamptz,
 released_by uuid REFERENCES public.user_profiles ON DELETE SET NULL,
 pin_hash text, pin_cipher text, attempts integer NOT NULL DEFAULT 0, pin_at timestamptz,
 recovery_consent boolean NOT NULL DEFAULT false, report_id uuid UNIQUE REFERENCES public.event_reports,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(allocation_id,event_id,code)
 REFERENCES public.event_tag_allocations(allocation_id,event_id,code)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_tag_one_open ON public.event_tag_registrations(code) WHERE status IN ('pending','held','office');
CREATE INDEX IF NOT EXISTS idx_event_tag_owner ON public.event_tag_registrations(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_tag_queue ON public.event_tag_registrations(event_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.event_tag_transfers (
 transfer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), registration_id uuid NOT NULL REFERENCES public.event_tag_registrations,
 requested_by uuid REFERENCES public.user_profiles ON DELETE SET NULL, receiver_id uuid REFERENCES public.user_profiles ON DELETE SET NULL,
 destination varchar(160) NOT NULL, source_position varchar(160) NOT NULL, destination_position varchar(160), created_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz, cancelled_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_tag_current_transfer ON public.event_tag_transfers(registration_id) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_tag_receiver ON public.event_tag_transfers(receiver_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.event_tag_history (
 request_id uuid PRIMARY KEY, actor_id uuid REFERENCES public.user_profiles ON DELETE SET NULL, action text NOT NULL,
 event_id uuid REFERENCES public.event_workspaces, code uuid REFERENCES public.event_tags,
 registration_id uuid REFERENCES public.event_tag_registrations, batch_id uuid REFERENCES public.event_tag_batches,
 pin_fingerprint text, expected_version integer, created_at timestamptz NOT NULL DEFAULT now(), outcome text NOT NULL DEFAULT 'saved'
);
CREATE INDEX IF NOT EXISTS idx_event_tag_trace ON public.event_tag_history(registration_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_tag_distinct_pin ON public.event_tag_history(code,pin_fingerprint) WHERE pin_fingerprint IS NOT NULL;

-- All commands lock event first, then inventory, then the registration. Requests serialize across retries.
CREATE OR REPLACE FUNCTION public.event_tag_command(p_actor uuid,p_action text,p_request uuid,p_event uuid,
 p_code uuid,p_registration uuid,p_version integer,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE
 actor public.user_profiles%ROWTYPE; e public.event_workspaces%ROWTYPE; t public.event_tags%ROWTYPE;
 a public.event_tag_allocations%ROWTYPE; r public.event_tag_registrations%ROWTYPE; x public.event_tag_transfers%ROWTYPE;
 old public.event_tag_history%ROWTYPE; batch uuid; role_name text; desk_version integer;
 is_admin boolean; is_staff boolean; is_manager boolean; is_receiver boolean;
 result text := 'saved'; report uuid; amount integer;
BEGIN
 IF p_request IS NULL OR p_data IS NULL THEN RAISE EXCEPTION 'Request reference required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 IF p_event IS NOT NULL THEN
  SELECT * INTO STRICT e FROM public.event_workspaces WHERE event_id=p_event FOR UPDATE;
 END IF;
 SELECT * INTO STRICT actor FROM public.user_profiles WHERE account_id=p_actor AND is_active IS TRUE
 AND (suspended_until IS NULL OR suspended_until<=now()) FOR SHARE;
 is_admin := coalesce(actor.access_level='super_admin',false);
 IF e.deleted_at IS NULL AND e.status IN ('scheduled','active','recovery') AND now()<e.recovery_ends_at THEN
  SELECT role INTO role_name FROM public.event_memberships WHERE event_id=p_event AND account_id=p_actor
  AND status='active' AND starts_at<=now() AND now()<expires_at FOR SHARE;
 END IF;
 is_staff := is_admin OR coalesce(role_name IN ('desk_staff','manager'),false);
 is_manager := is_admin OR coalesce(role_name='manager',false);
 SELECT * INTO old FROM public.event_tag_history WHERE request_id=p_request;
 IF FOUND THEN
  IF (old.actor_id,old.action,old.event_id,old.code,old.expected_version) IS DISTINCT FROM
     (p_actor,p_action,p_event,p_code,p_version) OR (p_registration IS NOT NULL AND old.registration_id IS DISTINCT FROM p_registration)
  THEN RAISE EXCEPTION 'Request belongs to another operation'; END IF;
  RETURN jsonb_build_object('outcome',old.outcome,'replay',true,'registration_id',old.registration_id,'batch_id',old.batch_id);
 END IF;
 IF p_action='issue' THEN
  IF NOT is_admin THEN RAISE EXCEPTION 'Super administrator required'; END IF;
  amount := (p_data->>'count')::integer;
  IF amount IS NULL OR amount NOT BETWEEN 1 AND 100 OR coalesce(length(trim(p_data->>'label')),0) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Invalid batch'; END IF;
  INSERT INTO public.event_tag_batches(label,created_by) VALUES(trim(p_data->>'label'),p_actor) RETURNING batch_id INTO batch;
  INSERT INTO public.event_tags(batch_id) SELECT batch FROM generate_series(1,amount);
 ELSIF p_action IN ('assign_batch','unassign_batch') THEN
  IF NOT is_admin OR e.event_id IS NULL OR (p_action='assign_batch' AND (e.deleted_at IS NOT NULL OR e.status NOT IN ('draft','scheduled','active')))
   OR jsonb_typeof(p_data->'tags') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'tags') NOT BETWEEN 1 AND 100
   THEN RAISE EXCEPTION 'Invalid batch allocation'; END IF;
  batch := (p_data->>'batch_id')::uuid;
  amount := 0;
  FOR t IN SELECT et.* FROM public.event_tags et
    JOIN jsonb_to_recordset(p_data->'tags') AS wanted(code uuid,version integer) USING(code,version)
    WHERE et.batch_id=batch ORDER BY et.code FOR UPDATE OF et LOOP
   IF p_action='assign_batch' THEN
    IF t.disabled OR EXISTS(SELECT FROM public.event_tag_allocations WHERE code=t.code AND ended_at IS NULL)
    THEN RAISE EXCEPTION 'Allocation changed. Refresh the batch'; END IF;
    INSERT INTO public.event_tag_allocations(code,event_id) VALUES(t.code,p_event);
   ELSE
    IF EXISTS(SELECT FROM public.event_tag_registrations WHERE code=t.code AND status IN ('pending','held','office'))
    THEN RAISE EXCEPTION 'Resolve held items before releasing their tags'; END IF;
    UPDATE public.event_tag_allocations SET ended_at=now() WHERE code=t.code AND event_id=p_event AND ended_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Allocation changed. Refresh the batch'; END IF;
   END IF;
   UPDATE public.event_tags SET version=version+1 WHERE code=t.code;
   amount:=amount+1;
  END LOOP;
  IF amount<>jsonb_array_length(p_data->'tags') THEN RAISE EXCEPTION 'Stale batch inventory'; END IF;
 ELSIF p_action='desk' THEN
  IF NOT is_admin OR e.event_id IS NULL OR e.deleted_at IS NOT NULL OR e.status NOT IN ('draft','scheduled','active','recovery')
   OR jsonb_typeof(p_data->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Desk setup unavailable'; END IF;
  IF p_data->'enabled'='true'::jsonb AND NOT EXISTS(SELECT FROM public.event_tag_allocations z JOIN public.event_tags et USING(code)
    WHERE z.event_id=p_event AND z.ended_at IS NULL AND NOT et.disabled) THEN RAISE EXCEPTION 'Assign usable tags to this desk before opening check-in'; END IF;
  SELECT version INTO desk_version FROM public.event_tag_desks WHERE event_id=p_event;
  IF coalesce(desk_version,0) IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Refresh desk setup'; END IF;
  INSERT INTO public.event_tag_desks(event_id,enabled) VALUES(p_event,(p_data->>'enabled')::boolean)
  ON CONFLICT(event_id) DO UPDATE SET enabled=excluded.enabled,version=event_tag_desks.version+1;
 ELSE
  SELECT * INTO STRICT t FROM public.event_tags WHERE code=p_code FOR UPDATE;
  SELECT * INTO a FROM public.event_tag_allocations WHERE code=p_code AND ended_at IS NULL FOR UPDATE;
  IF p_action IN ('assign','unassign','disable','enable') THEN
   IF NOT is_admin OR t.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Refresh tag inventory or check permissions'; END IF;
   IF p_action='assign' THEN
    IF e.event_id IS NULL OR e.deleted_at IS NOT NULL OR e.status NOT IN ('draft','scheduled','active') OR a.code IS NOT NULL OR t.disabled THEN RAISE EXCEPTION 'Tag unavailable for allocation'; END IF;
    INSERT INTO public.event_tag_allocations(event_id,code) VALUES(p_event,p_code);
   ELSE
    IF a.event_id IS DISTINCT FROM p_event OR EXISTS(SELECT FROM public.event_tag_registrations WHERE code=p_code AND status IN ('pending','held','office')) THEN RAISE EXCEPTION 'Resolve current registration and check allocation first'; END IF;
    IF p_action='unassign' THEN
     IF a.code IS NULL THEN RAISE EXCEPTION 'Tag is unassigned'; END IF;
     UPDATE public.event_tag_allocations SET ended_at=now() WHERE allocation_id=a.allocation_id;
    ELSE UPDATE public.event_tags SET disabled=(p_action='disable') WHERE code=p_code;
    END IF;
   END IF;
   UPDATE public.event_tags SET version=version+1 WHERE code=p_code;
  ELSIF p_action='register' THEN
   IF t.disabled OR a.event_id IS DISTINCT FROM p_event OR a.allocation_id IS DISTINCT FROM (p_data->>'allocation_id')::uuid
    OR t.version IS DISTINCT FROM p_version OR e.status IS DISTINCT FROM 'active' OR e.deleted_at IS NOT NULL
    OR NOT e.portal_enabled OR now() NOT BETWEEN e.starts_at AND e.ends_at OR actor.verification_status IS DISTINCT FROM 'verified'
    OR NOT EXISTS(SELECT FROM public.event_tag_desks WHERE event_id=p_event AND enabled) THEN RAISE EXCEPTION 'Check-in closed or allocation changed'; END IF;
   IF EXISTS(SELECT FROM public.event_tag_registrations WHERE code=p_code AND status IN ('pending','held','office')) THEN RAISE EXCEPTION 'Tag already in use'; END IF;
   INSERT INTO public.event_tag_registrations(allocation_id,event_id,code,owner_id,event_name,item_name,description,photo_path)
    VALUES(a.allocation_id,p_event,p_code,p_actor,e.name,p_data->>'item_name',p_data->>'description',p_data->>'photo_path') RETURNING * INTO r;
   UPDATE public.event_tags SET version=version+1 WHERE code=p_code;
  ELSE
   SELECT * INTO STRICT r FROM public.event_tag_registrations WHERE registration_id=p_registration AND event_id=p_event AND code=p_code FOR UPDATE;
   IF r.version IS DISTINCT FROM p_version OR r.status IN ('collected','cancelled') THEN RAISE EXCEPTION 'Refresh this registration'; END IF;
   SELECT * INTO x FROM public.event_tag_transfers WHERE registration_id=r.registration_id AND cancelled_at IS NULL FOR UPDATE;
   is_receiver := coalesce(x.receiver_id=p_actor AND actor.access_level IN ('guard','admin','super_admin'),false);
   IF p_action IN ('receive','accept') AND coalesce(length(trim(p_data->>'storage')),0) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Physical storage position required'; END IF;
   CASE p_action
   WHEN 'cancel' THEN
    IF r.status<>'pending' OR (r.owner_id IS DISTINCT FROM p_actor AND NOT is_manager) THEN RAISE EXCEPTION 'Pending owner or manager required'; END IF;
    UPDATE public.event_tag_registrations SET status='cancelled' WHERE registration_id=p_registration;
   WHEN 'receive' THEN
    IF NOT is_staff OR r.owner_id=p_actor OR r.status<>'pending' OR e.status<>'active' OR now()>e.ends_at THEN RAISE EXCEPTION 'Receipt unavailable'; END IF;
    UPDATE public.event_tag_registrations SET status='held',storage_position=p_data->>'storage',received_at=now(),received_by=p_actor,
     pin_hash=p_data->>'hash',pin_cipher=p_data->>'cipher',pin_at=now() WHERE registration_id=p_registration;
   WHEN 'reset_pin' THEN
    IF r.owner_id IS DISTINCT FROM p_actor OR r.status NOT IN ('held','office') OR now()<r.pin_at+interval '1 minute' THEN RAISE EXCEPTION 'Owner may renew the pickup PIN once a minute'; END IF;
    UPDATE public.event_tag_registrations SET pin_hash=p_data->>'hash',pin_cipher=p_data->>'cipher',pin_at=now(),attempts=0 WHERE registration_id=p_registration;
   WHEN 'collect' THEN
    IF r.owner_id=p_actor OR p_data->'identity_checked' IS DISTINCT FROM 'true'::jsonb
     OR NOT ((r.status='held' AND is_staff AND x.transfer_id IS NULL) OR (r.status='office' AND (is_admin OR is_receiver)))
     OR r.attempts>=5 OR now()>=r.pin_at+interval '24 hours' THEN RAISE EXCEPTION 'Collection unavailable. Check custody, identity and PIN validity'; END IF;
    IF r.pin_hash IS NULL OR r.pin_hash IS DISTINCT FROM (p_data->>'hash') THEN
     UPDATE public.event_tag_registrations SET attempts=attempts+1 WHERE registration_id=p_registration; result:='invalid_pin';
    ELSE
     UPDATE public.event_tag_registrations SET status='collected',released_by=p_actor,released_at=now(),pin_hash=NULL,pin_cipher=NULL WHERE registration_id=p_registration;
    END IF;
   WHEN 'transfer' THEN
    IF NOT is_manager OR r.status<>'held' OR x.transfer_id IS NOT NULL OR NOT EXISTS(SELECT FROM public.user_profiles
      WHERE account_id=(p_data->>'receiver_id')::uuid AND account_id<>p_actor AND account_id<>r.owner_id AND is_active AND access_level IN ('admin','guard','super_admin')
      AND (suspended_until IS NULL OR suspended_until<=now()) FOR SHARE) THEN RAISE EXCEPTION 'Choose a different active office receiver'; END IF;
    INSERT INTO public.event_tag_transfers(registration_id,requested_by,receiver_id,destination,source_position)
     VALUES(p_registration,p_actor,(p_data->>'receiver_id')::uuid,p_data->>'destination',r.storage_position);
   WHEN 'cancel_transfer' THEN
    IF NOT is_manager OR x.transfer_id IS NULL OR x.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Pending transfer required'; END IF;
    UPDATE public.event_tag_transfers SET cancelled_at=now() WHERE transfer_id=x.transfer_id;
   WHEN 'accept' THEN
    IF NOT is_receiver OR x.accepted_at IS NOT NULL OR r.status<>'held' THEN RAISE EXCEPTION 'Assigned receiving staff required'; END IF;
    UPDATE public.event_tag_transfers SET accepted_at=now(),destination_position=p_data->>'storage' WHERE transfer_id=x.transfer_id;
    UPDATE public.event_tag_registrations SET status='office',storage_position=p_data->>'storage' WHERE registration_id=p_registration;
   WHEN 'consent' THEN
    IF r.owner_id IS DISTINCT FROM p_actor OR r.report_id IS NOT NULL OR r.status NOT IN ('office','held') THEN RAISE EXCEPTION 'Owner consent unavailable'; END IF;
    UPDATE public.event_tag_registrations SET recovery_consent=(p_data->>'allowed')::boolean WHERE registration_id=p_registration;
   WHEN 'escalate' THEN
    IF NOT is_manager OR NOT r.recovery_consent OR r.report_id IS NOT NULL OR r.status NOT IN ('held','office') OR e.status NOT IN ('active','recovery')
    THEN RAISE EXCEPTION 'Open event, owner consent and manager required'; END IF;
    -- Missing-item investigation only. Physical release remains with this registration.
    INSERT INTO public.event_reports(event_id,reporter_account_id,request_id,kind,item_name,description,category,venue,occurred_at,board_consent)
     VALUES(p_event,r.owner_id,p_request,'missing',r.item_name,p_data->>'reason','Others',e.venue,r.created_at,true) RETURNING report_id INTO report;
    INSERT INTO public.event_report_history(event_id,report_id,actor_id,action,note)
     VALUES(p_event,report,p_actor,'created','Event storage recovery requested with owner permission.');
    UPDATE public.event_tag_registrations SET report_id=report WHERE registration_id=p_registration;
   WHEN 'remind' THEN
    IF NOT is_manager OR r.status NOT IN ('held','office') OR EXISTS(SELECT FROM public.event_tag_history WHERE registration_id=p_registration AND action='remind' AND created_at>now()-interval '1 day')
    THEN RAISE EXCEPTION 'One reminder per held item per day'; END IF;
   ELSE RAISE EXCEPTION 'Unknown event tag command';
   END CASE;
   UPDATE public.event_tag_registrations SET version=version+1 WHERE registration_id=p_registration;
  END IF;
 END IF;
 IF p_action IN ('receive','reset_pin') AND (nullif(p_data->>'fingerprint','') IS NULL OR nullif(p_data->>'hash','') IS NULL OR nullif(p_data->>'cipher','') IS NULL)
 THEN RAISE EXCEPTION 'Private pickup credential required'; END IF;
 INSERT INTO public.event_tag_history(request_id,actor_id,action,event_id,code,registration_id,batch_id,expected_version,outcome,pin_fingerprint)
 VALUES(p_request,p_actor,p_action,p_event,p_code,r.registration_id,batch,p_version,result,
   CASE WHEN p_action IN ('receive','reset_pin') THEN p_data->>'fingerprint' END);
 RETURN jsonb_build_object('outcome',result,'replay',false,'registration_id',r.registration_id,'batch_id',batch);
END $$;
CREATE OR REPLACE FUNCTION public.event_tag_counts(p_event uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object(
  'tag_allocated',(SELECT count(*) FROM public.event_tag_allocations WHERE event_id=p_event AND ended_at IS NULL),
  'tag_pending',count(*) FILTER(WHERE status='pending'),'tag_held',count(*) FILTER(WHERE status='held'),
  'tag_office',count(*) FILTER(WHERE status='office'),'tag_collected',count(*) FILTER(WHERE status='collected'),
  'tag_cancelled',count(*) FILTER(WHERE status='cancelled'),
  'tag_pending_transfers',(SELECT count(*) FROM public.event_tag_transfers t JOIN public.event_tag_registrations s USING(registration_id)
                         WHERE s.event_id=p_event AND t.accepted_at IS NULL AND t.cancelled_at IS NULL))
 FROM public.event_tag_registrations WHERE event_id=p_event;
$$;
REVOKE ALL ON FUNCTION public.event_tag_counts(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_tag_counts(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.event_tag_closing_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT FROM public.event_tag_registrations WHERE event_id=NEW.event_id AND status IN ('pending','held','office')) THEN
  RAISE EXCEPTION 'Resolve Event items before archiving, deleting or signing off';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_event_tag_workspace_guard BEFORE UPDATE OF status,deleted_at ON public.event_workspaces
 FOR EACH ROW WHEN ((NEW.status='archived' AND OLD.status<>'archived') OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL))
 EXECUTE FUNCTION public.event_tag_closing_guard();
CREATE OR REPLACE TRIGGER trg_event_tag_closure_guard BEFORE INSERT OR UPDATE ON public.event_closure_plans
 FOR EACH ROW WHEN (NEW.completed_at IS NOT NULL) EXECUTE FUNCTION public.event_tag_closing_guard();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['event_tag_batches','event_tags','event_tag_desks','event_tag_allocations','event_tag_registrations','event_tag_transfers','event_tag_history'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO service_role',t);
  IF t NOT IN ('event_tag_history','event_tag_batches') THEN EXECUTE format('GRANT UPDATE ON public.%I TO service_role',t); END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.event_tag_command(uuid,text,uuid,uuid,uuid,uuid,integer,jsonb), public.event_tag_closing_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_tag_command(uuid,text,uuid,uuid,uuid,uuid,integer,jsonb), public.event_tag_closing_guard() TO service_role;
INSERT INTO public.migration_log(name,note) VALUES ('20261124_event_smart_tags','Private reusable event QR custody pilot') ON CONFLICT(name) DO NOTHING;
COMMIT;
