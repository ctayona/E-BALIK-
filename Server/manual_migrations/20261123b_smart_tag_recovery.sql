-- User-run after 20261123_campus_venues. Private finder reports only.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.migration_log WHERE name='20261123_campus_venues') THEN RAISE EXCEPTION 'Campus venue migration required first'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.tag_recovery_reports (
 report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
 tag_id varchar(12) NOT NULL REFERENCES public.smart_tags ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES public.user_profiles(account_id) ON DELETE CASCADE,
 venue varchar(80) REFERENCES public.campus_venues(label), note varchar(300), contact varchar(120),
 created_at timestamptz NOT NULL DEFAULT now(), found_item_id uuid REFERENCES public.found_items(item_id) ON DELETE SET NULL,
 received_at timestamptz, returned_at timestamptz, review text NOT NULL DEFAULT 'clear' CHECK(review IN ('clear','flagged','reviewed')),
 UNIQUE(tag_id,request_id)
);
CREATE INDEX IF NOT EXISTS tag_recovery_owner ON public.tag_recovery_reports(owner_id,tag_id,created_at DESC);
CREATE INDEX IF NOT EXISTS tag_recovery_report_venue ON public.tag_recovery_reports(venue);
CREATE INDEX IF NOT EXISTS tag_recovery_flags ON public.tag_recovery_reports(created_at) WHERE review='flagged';
CREATE INDEX IF NOT EXISTS tag_recovery_item ON public.tag_recovery_reports(found_item_id);
CREATE TABLE IF NOT EXISTS public.tag_recovery_points (
 report_id uuid PRIMARY KEY REFERENCES public.tag_recovery_reports ON DELETE CASCADE,
 latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90), longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 accuracy double precision NOT NULL CHECK(accuracy BETWEEN 0 AND 100000), captured_at timestamptz NOT NULL,
 consent_version text NOT NULL CHECK(consent_version='finder-v1'), expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days'
);
CREATE INDEX IF NOT EXISTS tag_recovery_expiry ON public.tag_recovery_points(expires_at);
ALTER TABLE public.tag_recovery_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag_recovery_points ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tag_recovery_reports,public.tag_recovery_points FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.tag_recovery_reports TO service_role;
GRANT SELECT,INSERT,DELETE ON public.tag_recovery_points TO service_role;
CREATE OR REPLACE FUNCTION public.tag_recovery_submit(p_tag text,p_request uuid,p_venue text,p_note text,p_contact text,p_point jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE t public.smart_tags%rowtype; rid uuid; held_id uuid; intake_time timestamptz;
BEGIN
 SELECT * INTO t FROM public.smart_tags WHERE tag_id=p_tag FOR UPDATE;
 IF NOT FOUND OR t.owner_account_id IS NULL OR t.is_disabled OR t.status NOT IN ('active','lost') OR t.valid_until<=now() THEN RETURN '{"state":"inactive"}'; END IF;
 IF EXISTS(SELECT FROM public.tag_recovery_reports WHERE tag_id=p_tag AND request_id=p_request AND owner_id=t.owner_account_id) THEN RETURN '{"state":"duplicate"}'; END IF;
 IF p_venue IS NOT NULL AND NOT public.campus_venue_available(p_venue) THEN RETURN '{"state":"venue_unavailable"}'; END IF;
 IF t.last_found_notice_at>now()-interval '60 seconds' THEN RETURN '{"state":"cooldown"}'; END IF;
 -- A finder may submit after the office has already registered this item. Limit
 -- linkage to physical intake within this ownership period and still-open custody.
 SELECT f.item_id,f.created_at INTO held_id,intake_time FROM public.found_items f
 JOIN public.user_profiles staff ON staff.account_id=f.account_id AND staff.access_level IN ('super_admin','admin','guard')
 WHERE f.smart_tag_id=p_tag AND f.custody_status='turned_over' AND f.created_at>=t.claimed_at
   AND f.status IN ('unclaimed','pending','review','ready_to_release')
   AND NOT EXISTS(SELECT FROM public.claims c WHERE c.found_item_id=f.item_id AND c.status='collected')
 ORDER BY f.created_at DESC,f.item_id LIMIT 1 FOR SHARE OF f;
 INSERT INTO public.tag_recovery_reports(request_id,tag_id,owner_id,venue,note,contact,found_item_id,received_at)
 VALUES(p_request,p_tag,t.owner_account_id,p_venue,p_note,p_contact,held_id,intake_time) RETURNING report_id INTO rid;
 IF p_point IS NOT NULL AND p_point<>'null'::jsonb THEN
 IF (p_point->>'captured_at')::timestamptz NOT BETWEEN now()-interval '10 minutes' AND now()+interval '30 seconds' THEN RAISE EXCEPTION 'Invalid location timestamp'; END IF;
 INSERT INTO public.tag_recovery_points(report_id,latitude,longitude,accuracy,captured_at,consent_version)
 VALUES(rid,(p_point->>'latitude')::float8,(p_point->>'longitude')::float8,(p_point->>'accuracy')::float8,(p_point->>'captured_at')::timestamptz,p_point->>'consent_version');
 END IF;
 UPDATE public.smart_tags SET last_found_notice_at=now(),found_notice_count=found_notice_count+1 WHERE tag_id=p_tag;
 RETURN jsonb_build_object('state','saved','owner',t.owner_account_id,'item',t.item_name,'report',rid);
END $$;
REVOKE ALL ON FUNCTION public.tag_recovery_submit(text,uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tag_recovery_submit(text,uuid,text,text,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.tag_recovery_custody() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT has_table_privilege(current_user,'public.tag_recovery_reports','UPDATE') THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='found_items' THEN
 PERFORM 1 FROM public.smart_tags WHERE tag_id=NEW.smart_tag_id FOR UPDATE;
 UPDATE public.tag_recovery_reports r SET found_item_id=NEW.item_id,received_at=now()
 FROM public.smart_tags t WHERE t.tag_id=NEW.smart_tag_id AND r.tag_id=t.tag_id AND r.owner_id=t.owner_account_id AND r.received_at IS NULL
 AND EXISTS(SELECT FROM public.user_profiles staff WHERE staff.account_id=NEW.account_id AND staff.access_level IN ('super_admin','admin','guard') AND staff.is_active);
 ELSE
 UPDATE public.tag_recovery_reports SET returned_at=NEW.collected_at WHERE found_item_id=NEW.found_item_id AND owner_id=NEW.claimant_account_id AND returned_at IS NULL;
 DELETE FROM public.tag_recovery_points p USING public.tag_recovery_reports r WHERE p.report_id=r.report_id AND r.found_item_id=NEW.found_item_id AND r.returned_at IS NOT NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tag_recovery_custody() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER tag_recovery_received AFTER INSERT ON public.found_items FOR EACH ROW WHEN(NEW.smart_tag_id IS NOT NULL AND NEW.custody_status='turned_over') EXECUTE FUNCTION public.tag_recovery_custody();
CREATE OR REPLACE TRIGGER tag_recovery_returned AFTER UPDATE ON public.claims FOR EACH ROW WHEN(NEW.status='collected' AND NEW.collected_at IS NOT NULL AND NEW.released_by IS NOT NULL AND OLD.status IS DISTINCT FROM 'collected') EXECUTE FUNCTION public.tag_recovery_custody();
INSERT INTO public.migration_log(name,note) SELECT '20261123b_smart_tag_recovery','Private Smart Tag recovery' WHERE NOT EXISTS(SELECT FROM public.migration_log WHERE name='20261123b_smart_tag_recovery');
COMMIT;
