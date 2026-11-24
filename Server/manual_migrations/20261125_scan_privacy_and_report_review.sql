-- Manual application only. Additive; existing reports retain publication approval.
-- Run after the campus venues and Smart Tag recovery migrations. No report/custody deletion.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.migration_log WHERE name='20261123b_smart_tag_recovery') THEN
  RAISE EXCEPTION 'Apply Smart Tag recovery first';
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.smart_tag_scans (
 scan_id uuid PRIMARY KEY, tag_id varchar NOT NULL REFERENCES public.smart_tags(tag_id) ON DELETE CASCADE,
 owner_id uuid REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
 token_hash text NOT NULL CHECK(length(token_hash)=64),
 scanned_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 admin_consent boolean NOT NULL DEFAULT false, owner_consent boolean NOT NULL DEFAULT false,
 consent_version text, shared_at timestamptz, withdrawn_at timestamptz,
 venue text, drop_off text, latitude double precision, longitude double precision, accuracy double precision,
 captured_at timestamptz, location_expires_at timestamptz,
 resolved_at timestamptz, resolved_by uuid REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
 version integer NOT NULL DEFAULT 1,
 CHECK(latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND accuracy BETWEEN 0 AND 100000),
 CHECK((latitude IS NULL AND longitude IS NULL AND accuracy IS NULL AND captured_at IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL AND accuracy IS NOT NULL AND captured_at IS NOT NULL)),
 CHECK((venue IS NULL AND drop_off IS NULL AND latitude IS NULL) OR
       ((admin_consent OR owner_consent) AND consent_version='scan-v1' AND location_expires_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_smart_tag_scans_tag_time ON public.smart_tag_scans(tag_id,scanned_at DESC);
CREATE INDEX IF NOT EXISTS ix_smart_tag_scans_expiry ON public.smart_tag_scans(expires_at);
CREATE INDEX IF NOT EXISTS ix_smart_tag_scans_time ON public.smart_tag_scans(scanned_at DESC,scan_id);
CREATE INDEX IF NOT EXISTS ix_smart_tag_scans_owner ON public.smart_tag_scans(owner_id,scanned_at DESC) WHERE owner_consent;
ALTER TABLE public.smart_tag_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smart_tag_scans FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.smart_tag_scans TO service_role;

CREATE OR REPLACE FUNCTION public.smart_tag_scan_command(p_action text,p_scan uuid,p_tag text,p_hash text,p_data jsonb DEFAULT '{}',p_actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r public.smart_tag_scans; t public.smart_tags; v_admin boolean; v_owner boolean;
BEGIN
 IF p_action='record' THEN
  IF length(p_hash)<>64 THEN RAISE EXCEPTION 'Invalid receipt'; END IF;
  SELECT * INTO t FROM public.smart_tags WHERE tag_id=p_tag FOR SHARE;
  IF NOT FOUND OR t.is_disabled OR t.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Tag unavailable'; END IF;
  INSERT INTO public.smart_tag_scans(scan_id,tag_id,owner_id,token_hash)
  VALUES(p_scan,p_tag,t.owner_account_id,p_hash) ON CONFLICT(scan_id) DO NOTHING;
 END IF;
 SELECT * INTO r FROM public.smart_tag_scans WHERE scan_id=p_scan FOR UPDATE;
 IF NOT FOUND OR r.expires_at<=now() THEN RAISE EXCEPTION 'Scan unavailable'; END IF;
 IF p_action='resolve' THEN
  IF NOT EXISTS(SELECT FROM public.user_profiles WHERE account_id=p_actor AND access_level IN ('admin','super_admin')
      AND is_active IS NOT FALSE AND (suspended_until IS NULL OR suspended_until<=now())) THEN RAISE EXCEPTION 'Administrator required'; END IF;
  IF (p_data->>'version')::integer<>r.version THEN RAISE EXCEPTION 'Scan changed; refresh'; END IF;
 ELSE
  IF r.token_hash IS DISTINCT FROM p_hash OR r.tag_id IS DISTINCT FROM p_tag THEN RAISE EXCEPTION 'Scan unavailable'; END IF;
 END IF;
 IF p_action='record' THEN RETURN jsonb_build_object('scan_id',r.scan_id,'scanned_at',r.scanned_at); END IF;
 IF p_action='share' THEN
  IF r.resolved_at IS NOT NULL OR r.withdrawn_at IS NOT NULL OR r.scanned_at<now()-interval '15 minutes' THEN RAISE EXCEPTION 'Sharing window ended'; END IF;
  SELECT * INTO t FROM public.smart_tags WHERE tag_id=r.tag_id FOR SHARE;
  IF NOT FOUND OR t.is_disabled OR t.archived_at IS NOT NULL OR t.owner_account_id IS DISTINCT FROM r.owner_id THEN RAISE EXCEPTION 'Tag changed'; END IF;
  v_admin=coalesce((p_data->>'admin_consent')::boolean,false);
  v_owner=coalesce((p_data->>'owner_consent')::boolean,false);
  IF NOT(v_admin OR v_owner) OR p_data->>'consent_version' IS DISTINCT FROM 'scan-v1' THEN RAISE EXCEPTION 'Explicit consent required'; END IF;
  IF v_owner AND r.owner_id IS NULL THEN RAISE EXCEPTION 'This tag has no registered owner'; END IF;
  IF nullif(p_data->>'venue','') IS NULL AND nullif(p_data->>'drop_off','') IS NULL AND coalesce(p_data->'point','null')='null'::jsonb THEN RAISE EXCEPTION 'Location required'; END IF;
  IF r.shared_at IS NOT NULL THEN
   IF r.admin_consent=v_admin AND r.owner_consent=v_owner AND r.venue IS NOT DISTINCT FROM nullif(p_data->>'venue','')
    AND r.drop_off IS NOT DISTINCT FROM nullif(p_data->>'drop_off','') AND r.latitude IS NOT DISTINCT FROM (p_data->'point'->>'latitude')::double precision
    AND r.longitude IS NOT DISTINCT FROM (p_data->'point'->>'longitude')::double precision THEN
    RETURN jsonb_build_object('scan_id',r.scan_id,'version',r.version,'shared_at',r.shared_at,'replayed',true);
   END IF;
   RAISE EXCEPTION 'Location already shared; withdraw to remove it';
  END IF;
  IF p_data->'point' IS NOT NULL AND p_data->'point'<>'null'::jsonb AND
    NOT ((p_data->'point'->>'captured_at')::timestamptz BETWEEN now()-interval '10 minutes' AND now()+interval '30 seconds') THEN RAISE EXCEPTION 'Location expired'; END IF;
  UPDATE public.smart_tag_scans SET admin_consent=v_admin,owner_consent=v_owner,consent_version='scan-v1',shared_at=now(),
   venue=nullif(p_data->>'venue',''),drop_off=nullif(p_data->>'drop_off',''),
   latitude=(p_data->'point'->>'latitude')::double precision,longitude=(p_data->'point'->>'longitude')::double precision,
   accuracy=(p_data->'point'->>'accuracy')::double precision,captured_at=(p_data->'point'->>'captured_at')::timestamptz,
   location_expires_at=least(now()+interval '7 days',expires_at),version=version+1 WHERE scan_id=p_scan RETURNING * INTO r;
 ELSIF p_action IN ('withdraw','resolve') THEN
  UPDATE public.smart_tag_scans SET venue=NULL,drop_off=NULL,latitude=NULL,longitude=NULL,accuracy=NULL,captured_at=NULL,
   location_expires_at=NULL,admin_consent=CASE WHEN p_action='withdraw' THEN false ELSE admin_consent END,
   owner_consent=CASE WHEN p_action='withdraw' THEN false ELSE owner_consent END,
   withdrawn_at=CASE WHEN p_action='withdraw' THEN coalesce(withdrawn_at,now()) ELSE withdrawn_at END,
   resolved_at=CASE WHEN p_action='resolve' THEN coalesce(resolved_at,now()) ELSE resolved_at END,
   resolved_by=CASE WHEN p_action='resolve' THEN p_actor ELSE resolved_by END,version=version+1
   WHERE scan_id=p_scan RETURNING * INTO r;
 ELSE RAISE EXCEPTION 'Unknown scan action'; END IF;
 RETURN jsonb_build_object('scan_id',r.scan_id,'version',r.version,'shared_at',r.shared_at,'withdrawn_at',r.withdrawn_at,'resolved_at',r.resolved_at);
END $$;

CREATE OR REPLACE FUNCTION public.smart_tag_scan_returned() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$ BEGIN
 IF NEW.status='returned' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.smart_tag_id IS NOT NULL THEN
  UPDATE public.smart_tag_scans SET venue=NULL,drop_off=NULL,latitude=NULL,longitude=NULL,accuracy=NULL,captured_at=NULL,
   location_expires_at=NULL,resolved_at=coalesce(resolved_at,now()),version=version+1
   WHERE tag_id=NEW.smart_tag_id AND resolved_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_smart_tag_scan_returned ON public.found_items;
CREATE TRIGGER trg_smart_tag_scan_returned AFTER UPDATE ON public.found_items FOR EACH ROW EXECUTE FUNCTION public.smart_tag_scan_returned();
REVOKE ALL ON FUNCTION public.smart_tag_scan_returned() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.smart_tag_scan_cleanup() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$ BEGIN
 UPDATE public.smart_tag_scans SET venue=NULL,drop_off=NULL,latitude=NULL,longitude=NULL,accuracy=NULL,captured_at=NULL,location_expires_at=NULL
 WHERE location_expires_at<=now() OR resolved_at IS NOT NULL OR withdrawn_at IS NOT NULL;
 DELETE FROM public.smart_tag_scans WHERE expires_at<=now();
END $$;
REVOKE ALL ON FUNCTION public.smart_tag_scan_command(text,uuid,text,text,jsonb,uuid),public.smart_tag_scan_cleanup() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.smart_tag_scan_command(text,uuid,text,text,jsonb,uuid),public.smart_tag_scan_cleanup() TO service_role;

-- Existing reports remain approved. New inserts and content edits require review.
ALTER TABLE public.found_items ADD COLUMN IF NOT EXISTS publication_state text NOT NULL DEFAULT 'approved'
 CHECK(publication_state IN ('pending','approved','rejected'));
ALTER TABLE public.missing_items ADD COLUMN IF NOT EXISTS publication_state text NOT NULL DEFAULT 'approved'
 CHECK(publication_state IN ('pending','approved','rejected'));
ALTER TABLE public.found_items ALTER COLUMN publication_state SET DEFAULT 'pending';
ALTER TABLE public.missing_items ALTER COLUMN publication_state SET DEFAULT 'pending';
ALTER TABLE public.found_items ADD COLUMN IF NOT EXISTS publication_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.missing_items ADD COLUMN IF NOT EXISTS publication_version integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS ix_found_publication_queue ON public.found_items(publication_state,created_at DESC);
CREATE INDEX IF NOT EXISTS ix_missing_publication_queue ON public.missing_items(publication_state,created_at DESC);
CREATE TABLE IF NOT EXISTS public.report_publication_history (
 request_id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('found','missing')),item_id uuid NOT NULL,
 actor_id uuid REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
 state text NOT NULL CHECK(state IN ('approved','rejected')),note text NOT NULL DEFAULT '' CHECK(length(note)<=300),
 version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.report_publication_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_publication_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.report_publication_history TO service_role;
-- All app access is mediated by Flask service credentials; browser roles cannot bypass review or read reporter identifiers.
ALTER TABLE public.found_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missing_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.found_items,public.missing_items FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.found_items,public.missing_items TO service_role;

CREATE OR REPLACE FUNCTION public.report_publication_content_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF current_setting('ebalik.report_review',true) IS DISTINCT FROM 'on' THEN
  NEW.publication_state=OLD.publication_state; NEW.publication_version=OLD.publication_version;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','custody_status','turnover_location','guard_name_or_id','handover_guard_id','received_at','received_by','archived_at','archived_by','updated_at','image_features','publication_state','publication_version'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','custody_status','turnover_location','guard_name_or_id','handover_guard_id','received_at','received_by','archived_at','archived_by','updated_at','image_features','publication_state','publication_version']) THEN
  NEW.publication_state='pending'; NEW.publication_version=OLD.publication_version+1;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_found_publication_content ON public.found_items;
CREATE TRIGGER trg_found_publication_content BEFORE UPDATE ON public.found_items FOR EACH ROW EXECUTE FUNCTION public.report_publication_content_guard();
DROP TRIGGER IF EXISTS trg_missing_publication_content ON public.missing_items;
CREATE TRIGGER trg_missing_publication_content BEFORE UPDATE ON public.missing_items FOR EACH ROW EXECUTE FUNCTION public.report_publication_content_guard();

CREATE OR REPLACE FUNCTION public.report_publication_review(p_actor uuid,p_request uuid,p_kind text,p_item uuid,p_version integer,p_state text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE tbl text; r jsonb; h public.report_publication_history; previous_setting text;
BEGIN
 IF NOT EXISTS(SELECT FROM public.user_profiles WHERE account_id=p_actor AND access_level IN ('admin','super_admin')
   AND is_active IS NOT FALSE AND (suspended_until IS NULL OR suspended_until<=now())) THEN RAISE EXCEPTION 'Administrator required'; END IF;
 IF p_kind NOT IN ('found','missing') OR p_state NOT IN ('approved','rejected') OR length(coalesce(p_note,''))>300 THEN RAISE EXCEPTION 'Invalid review'; END IF;
 IF p_state='rejected' AND length(trim(coalesce(p_note,'')))<5 THEN RAISE EXCEPTION 'Explain the rejection'; END IF;
 SELECT * INTO h FROM public.report_publication_history WHERE request_id=p_request;
 IF FOUND THEN
  IF h.actor_id IS DISTINCT FROM p_actor OR h.kind<>p_kind OR h.item_id<>p_item OR h.state<>p_state OR h.note IS DISTINCT FROM coalesce(p_note,'') OR h.version<>p_version+1 THEN RAISE EXCEPTION 'Request reference reused'; END IF;
  RETURN jsonb_build_object('state',h.state,'version',h.version,'replayed',true);
 END IF;
 tbl=CASE WHEN p_kind='found' THEN 'found_items' ELSE 'missing_items' END;
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE item_id=$1 FOR UPDATE',tbl) INTO r USING p_item;
 IF r IS NULL OR r->>'archived_at' IS NOT NULL THEN RAISE EXCEPTION 'Report unavailable'; END IF;
 IF (r->>'publication_version')::integer<>p_version OR r->>'publication_state'<>'pending' THEN RAISE EXCEPTION 'Report changed; refresh'; END IF;
 previous_setting=current_setting('ebalik.report_review',true);
 PERFORM set_config('ebalik.report_review','on',true);
 EXECUTE format('UPDATE public.%I SET publication_state=$1,publication_version=publication_version+1 WHERE item_id=$2',tbl) USING p_state,p_item;
 PERFORM set_config('ebalik.report_review',coalesce(previous_setting,''),true);
 INSERT INTO public.report_publication_history(request_id,kind,item_id,actor_id,state,note,version)
 VALUES(p_request,p_kind,p_item,p_actor,p_state,coalesce(p_note,''),p_version+1);
 RETURN jsonb_build_object('state',p_state,'version',p_version+1,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.report_publication_review(uuid,uuid,text,uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.report_publication_review(uuid,uuid,text,uuid,integer,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.report_publication_content_guard() FROM PUBLIC,anon,authenticated;
INSERT INTO public.migration_log(name,note) VALUES('20261125_scan_privacy_and_report_review','Private consent-based scan locations and independent report publication review') ON CONFLICT(name) DO NOTHING;
COMMIT;
-- Verify manually: migration receipt; RLS/grants; existing states preserved; offline acceptance in docs/SCAN_PRIVACY_REPORT_REVIEW.md.
