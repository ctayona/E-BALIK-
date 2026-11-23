-- User-run combined venue catalogue and management. Run before Smart Tag recovery.
-- No historical location values are rewritten. One transaction covers all objects.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.campus_venues (
 label varchar(80) PRIMARY KEY, active boolean NOT NULL DEFAULT true
);
ALTER TABLE public.campus_venues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campus_venues FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT,INSERT,UPDATE ON public.campus_venues TO service_role;
INSERT INTO public.campus_venues(label) VALUES
 ('Library'),
 ('Gymnasium'),
 ('Cafeteria'),
 ('Admin Building'),
 ('Oval Track'),
 ('Engineering Building'),
 ('Lost and Found Office'),
 ('Main Building Lobby'),
 ('Student Center'),
 ('ICT Building'),
 ('Faculty Hall'),
 ('Gym'),
 ('HPSB Building'),
 ('Other'),
 ('Administration Building'),
 ('Administration Building / Basement'),
 ('Administration Building / Basement / Food Hub'),
 ('Administration Building / Basement / OHSO'),
 ('Administration Building / Ground'),
 ('Administration Building / Ground / UMak Auditorium'),
 ('Administration Building / Mezzanine'),
 ('Administration Building / Mezzanine / Registrar'),
 ('Administration Building / 2F'),
 ('Administration Building / 2F / Library Learning Commons'),
 ('Administration Building / 5F'),
 ('Administration Building / 5F / Room A1'),
 ('Administration Building / 5F / Room A2'),
 ('Administration Building / 5F / Room A3'),
 ('Administration Building / 5F / Room A4'),
 ('Administration Building / 5F / Room A5'),
 ('Administration Building / 5F / Room A6'),
 ('Administration Building / 5F / Room A7'),
 ('Administration Building / 5F / Room A8'),
 ('Administration Building / 5F / Room A9'),
 ('Administration Building / 5F / Room A10'),
 ('Administration Building / 5F / Room A11'),
 ('Administration Building / 5F / Room A12'),
 ('Administration Building / 5F / Room A'),
 ('Administration Building / 5F / Room B'),
 ('Administration Building / 5F / Room C'),
 ('Administration Building / 5F / Room D'),
 ('Academic Building I'),
 ('Academic Building I / 3F'),
 ('Academic Building I / 3F / Skills Laboratories'),
 ('Academic Building II'),
 ('Academic Building II / 1F'),
 ('Academic Building II / 1F / Room 101'),
 ('Academic Building II / 1F / Room 102'),
 ('Academic Building II / 1F / Room 103'),
 ('Academic Building II / 1F / Room 104'),
 ('Academic Building II / 1F / Room 105'),
 ('Academic Building II / 1F / Room 109'),
 ('Academic Building II / 1F / Room 110'),
 ('Academic Building II / 1F / Room 111'),
 ('Academic Building II / 1F / Room 112'),
 ('Academic Building II / 2F'),
 ('Academic Building II / 2F / Room 201'),
 ('Academic Building II / 2F / Room 202'),
 ('Academic Building II / 2F / Room 203'),
 ('Academic Building II / 2F / Room 204'),
 ('Academic Building II / 2F / Room 208'),
 ('Academic Building II / 2F / Room 210'),
 ('Academic Building II / 2F / Room 212'),
 ('Academic Building II / 4F'),
 ('Academic Building II / 4F / Room 401'),
 ('Academic Building II / 4F / Room 403'),
 ('Academic Building II / 4F / Room 404'),
 ('Academic Building II / 4F / Room 405'),
 ('Academic Building II / 4F / Room 406'),
 ('Academic Building II / 4F / Room 408'),
 ('Academic Building II / 4F / Room 409'),
 ('Academic Building II / 4F / Room 410'),
 ('Academic Building II / 3F'),
 ('Academic Building II / 3F / Room 301'),
 ('Academic Building II / 3F / Room 302'),
 ('Academic Building II / 3F / Room 304'),
 ('Academic Building II / 3F / Room 306'),
 ('Academic Building II / 3F / Room 308'),
 ('Academic Building II / 3F / Room 309'),
 ('Academic Building II / 3F / Room 310'),
 ('Academic Building II / 3F / Room 311'),
 ('Academic Building II / 3F / Room 312'),
 ('Academic Building III'),
 ('Academic Building III / 1F'),
 ('Academic Building III / 1F / Room 101'),
 ('Academic Building III / 1F / Room 102'),
 ('Academic Building III / 1F / Room 103'),
 ('Academic Building III / 1F / Room 104'),
 ('Academic Building III / 1F / Room 105'),
 ('Academic Building III / 1F / Room 106'),
 ('Academic Building III / 1F / Room 107'),
 ('Academic Building III / 1F / Room 108'),
 ('Academic Building III / 2F'),
 ('Academic Building III / 2F / Room 201'),
 ('Academic Building III / 2F / Room 202'),
 ('Academic Building III / 2F / Room 203'),
 ('Academic Building III / 2F / Room 204'),
 ('Academic Building III / 2F / Room 205'),
 ('Academic Building III / 2F / Room 206'),
 ('Academic Building III / 2F / Room 207'),
 ('Academic Building III / 2F / Room 208'),
 ('Academic Building III / 2F / Room 210'),
 ('Academic Building III / 2F / Room 212'),
 ('Academic Building III / 3F'),
 ('Academic Building III / 3F / Room 301'),
 ('Academic Building III / 3F / Room 302'),
 ('Academic Building III / 3F / Room 303'),
 ('Academic Building III / 3F / Room 304'),
 ('Academic Building III / 3F / Room 305'),
 ('Academic Building III / 3F / Room 306'),
 ('Academic Building III / 3F / Room 307'),
 ('Academic Building III / 3F / Room 308'),
 ('Academic Building III / 3F / Room 309'),
 ('Academic Building III / 3F / Room 310'),
 ('Academic Building III / 3F / Room 311'),
 ('Academic Building III / 3F / Room 312'),
 ('Academic Building III / 4F'),
 ('Academic Building III / 4F / Room 401'),
 ('Academic Building III / 4F / Room 402'),
 ('Academic Building III / 4F / Room 403'),
 ('Academic Building III / 4F / Room 404'),
 ('Academic Building III / 4F / Room 405'),
 ('Academic Building III / 4F / Room 406'),
 ('Academic Building III / 4F / Room 407'),
 ('Academic Building III / 4F / Room 408'),
 ('Academic Building III / 4F / Room 409'),
 ('Academic Building III / 4F / Room 410'),
 ('Academic Building III / 4F / Room 411'),
 ('Academic Building III / 4F / Room 412'),
 ('Academic Building III / 4F / Room 413'),
 ('Academic Building III / 4F / Room 414'),
 ('Academic Building III / 4F / Room 415'),
 ('Academic Building III / 4F / Room 416'),
 ('Academic Bridgeway'),
 ('Academic Bridgeway / 1F'),
 ('Academic Bridgeway / 1F / Open Area'),
 ('Academic Bridgeway / 2F'),
 ('Academic Bridgeway / 2F / Room 201'),
 ('Academic Bridgeway / 2F / Room 202'),
 ('Academic Bridgeway / 3F'),
 ('Academic Bridgeway / 3F / Room 301'),
 ('Academic Bridgeway / 3F / Room 302'),
 ('Academic Bridgeway / 4F'),
 ('Academic Bridgeway / 4F / Room 401'),
 ('Academic Bridgeway / 4F / Room 402'),
 ('HPSB'),
 ('HPSB / Ground'),
 ('HPSB / Ground / Main Lobby'),
 ('HPSB / 5F'),
 ('HPSB / 5F / Room 504'),
 ('HPSB / 5F / Room 505'),
 ('HPSB / 5F / Room 506'),
 ('HPSB / 5F / Room 507'),
 ('HPSB / 5F / Room 508'),
 ('HPSB / 5F / Room 509'),
 ('HPSB / 5F / Room 510'),
 ('HPSB / 5F / Room 511'),
 ('HPSB / 5F / Room 512'),
 ('HPSB / 6F'),
 ('HPSB / 6F / Room 601'),
 ('HPSB / 6F / Room 602'),
 ('HPSB / 6F / Room 603'),
 ('HPSB / 6F / Room 604'),
 ('HPSB / 6F / Room 605'),
 ('HPSB / 6F / Room 606'),
 ('HPSB / 6F / Room 607'),
 ('HPSB / 6F / Room 608'),
 ('HPSB / 6F / Room 609'),
 ('HPSB / 6F / Room 610'),
 ('HPSB / 6F / Room 611'),
 ('HPSB / 6F / Room 612'),
 ('HPSB / 6F / Room 613'),
 ('HPSB / 6F / Room 614'),
 ('HPSB / 6F / Room 615'),
 ('HPSB / 6F / Room 617'),
 ('HPSB / 7F'),
 ('HPSB / 7F / Room 701'),
 ('HPSB / 7F / Room 702'),
 ('HPSB / 7F / Room 703'),
 ('HPSB / 7F / Room 704'),
 ('HPSB / 7F / Room 705'),
 ('HPSB / 7F / Room 706'),
 ('HPSB / 7F / Room 707'),
 ('HPSB / 7F / Room 708'),
 ('HPSB / 7F / Room 709'),
 ('HPSB / 7F / Room 710'),
 ('HPSB / 7F / Room 712'),
 ('HPSB / 8F'),
 ('HPSB / 8F / Room 801'),
 ('HPSB / 8F / Room 802'),
 ('HPSB / 8F / Room 803'),
 ('HPSB / 8F / Room 804'),
 ('HPSB / 8F / Room 805'),
 ('HPSB / 8F / Room 806'),
 ('HPSB / 8F / Room 807'),
 ('HPSB / 8F / Room 808'),
 ('HPSB / 8F / Room 809'),
 ('HPSB / 8F / Room 810'),
 ('HPSB / 8F / Room 811'),
 ('HPSB / 8F / Room 812'),
 ('HPSB / 8F / Room 813'),
 ('HPSB / 8F / Room 814'),
 ('HPSB / 8F / Room 815'),
 ('HPSB / 8F / Room 817'),
 ('HPSB / 9F'),
 ('HPSB / 9F / Room 901'),
 ('HPSB / 9F / Room 902'),
 ('HPSB / 9F / Room 906'),
 ('HPSB / 9F / Room 907'),
 ('HPSB / 9F / Room 908'),
 ('HPSB / 9F / Room 909'),
 ('HPSB / 10F'),
 ('HPSB / 10F / Room 1001'),
 ('HPSB / 10F / Room 1002'),
 ('HPSB / 10F / Room 1003'),
 ('HPSB / 10F / Room 1004'),
 ('HPSB / 10F / Room 1005'),
 ('HPSB / 10F / Room 1006'),
 ('HPSB / 10F / Room 1007'),
 ('HPSB / 10F / Room 1008'),
 ('HPSB / 10F / Room 1009'),
 ('HPSB / 10F / Room 1010'),
 ('HPSB / 10F / Room 1011'),
 ('HPSB / 10F / Room 1012'),
 ('HPSB / 10F / Room 1013'),
 ('HPSB / 10F / Room 1014'),
 ('HPSB / 10F / Room 1015'),
 ('HPSB / 10F / Room 1016'),
 ('HPSB / 10F / Room 1017'),
 ('HPSB / 11F'),
 ('HPSB / 11F / Dance Studio'),
 ('HPSB / 11F / Room 1101'),
 ('HPSB / 12F'),
 ('HPSB / 12F / Basketball Court'),
 ('HPSB / 12F / Volleyball Court'),
 ('UMak Stadium'),
 ('UMak Stadium / Ground'),
 ('UMak Stadium / Ground / Oval Track'),
 ('UMak Stadium / Ground / Guard House')
ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.campus_venue_available(p_label text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT FROM public.campus_venues WHERE label=p_label AND active)
 AND NOT EXISTS(SELECT FROM public.campus_venues WHERE NOT active AND starts_with(p_label,label||' / '));
$$;
REVOKE ALL ON FUNCTION public.campus_venue_available(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campus_venue_available(text) TO service_role;
DO $$
DECLARE definition text; predicate text := 'e.venue IN (''Library'',''Gymnasium'',''Cafeteria'',''Admin Building'',''Oval Track'',''Engineering Building'',''Lost and Found Office'')';
BEGIN
 IF EXISTS (SELECT FROM public.migration_log WHERE name='20261123_campus_venues') THEN RETURN; END IF;
 SELECT pg_get_functiondef('public.event_transition(uuid,uuid,integer,text,text)'::regprocedure) INTO definition;
 IF position(predicate IN definition)=0 THEN RAISE EXCEPTION 'Unexpected event transition definition. Review before applying.'; END IF;
 EXECUTE replace(definition,predicate,'(public.campus_venue_available(e.venue) AND e.venue NOT IN (''Main Building Lobby'',''Student Center'',''ICT Building'',''Faculty Hall'',''Gym'',''HPSB Building'',''Other''))');
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.event_reports'::regclass
   AND conname='event_reports_venue_check' AND contype='c' AND pg_get_constraintdef(oid) LIKE '%Engineering Building%Lost and Found Office%') THEN
   RAISE EXCEPTION 'Unexpected event report venue constraint. Review before applying.';
 END IF;
 ALTER TABLE public.event_reports ADD CONSTRAINT event_reports_catalogue_fk FOREIGN KEY(venue) REFERENCES public.campus_venues(label);
 ALTER TABLE public.event_reports DROP CONSTRAINT event_reports_venue_check;
 INSERT INTO public.migration_log(name,note) VALUES ('20261123_campus_venues','Extend event venue validation, preserve existing venue text');
END $$;
ALTER TABLE public.campus_venues ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE TABLE IF NOT EXISTS public.campus_venue_history (
 history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
 action text NOT NULL CHECK(action IN ('create','rename','availability')),
 previous_label varchar(80), label varchar(80) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campus_venue_history_actor ON public.campus_venue_history(actor_id);
ALTER TABLE public.campus_venue_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campus_venue_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.campus_venue_history TO service_role;
CREATE OR REPLACE FUNCTION public.campus_venue_manage(
 p_actor uuid,p_action text,p_label text,p_target text,p_active boolean,p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE current_row public.campus_venues%rowtype; target text; parent text; depth integer;
BEGIN
 IF NOT EXISTS(SELECT FROM public.user_profiles WHERE account_id=p_actor AND access_level='super_admin'
   AND is_active IS TRUE AND (suspended_until IS NULL OR suspended_until<=now())) THEN
  RETURN jsonb_build_object('ok',false,'error','Active super administrator required.');
 END IF;
 -- Serialize edits across whole subtrees so a room cannot be added midway through a rename.
 PERFORM pg_advisory_xact_lock(20261123,1);
 IF p_action NOT IN ('create','rename','availability') OR p_action IS NULL THEN
  RETURN jsonb_build_object('ok',false,'error','Unknown venue action.');
 END IF;
 IF p_action<>'create' THEN
  SELECT * INTO current_row FROM public.campus_venues WHERE label=p_label FOR UPDATE;
  IF NOT FOUND OR current_row.version IS DISTINCT FROM p_version THEN
   RETURN jsonb_build_object('ok',false,'error','Location changed. Refresh before saving.');
  END IF;
  IF p_label IN ('Library','Gymnasium','Cafeteria','Admin Building','Oval Track','Engineering Building',
   'Lost and Found Office','Main Building Lobby','Student Center','ICT Building','Faculty Hall','Gym','HPSB Building','Other') THEN
   RETURN jsonb_build_object('ok',false,'error','Historical compatibility labels are protected.');
  END IF;
 END IF;
 IF p_action='availability' THEN
  IF p_active IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Choose availability.'); END IF;
  UPDATE public.campus_venues SET active=p_active,version=version+1 WHERE label=p_label;
  target:=p_label;
 ELSE
  target:=p_target;
  IF target IS NULL OR length(target) NOT BETWEEN 3 AND 80 OR target<>btrim(target)
    OR target ~ '[<>[:cntrl:]]' OR target ~ ' {2}' THEN
   RETURN jsonb_build_object('ok',false,'error','Use a plain location name up to 80 characters.');
  END IF;
  depth:=cardinality(string_to_array(target,' / '));
  IF depth>3 OR EXISTS(SELECT FROM unnest(string_to_array(target,' / ')) part
    WHERE length(btrim(part))<1 OR part<>btrim(part) OR strpos(part,'/')>0) THEN
   RETURN jsonb_build_object('ok',false,'error','Use building, floor and optional room.');
  END IF;
  IF depth>1 THEN
   parent:=array_to_string((string_to_array(target,' / '))[1:depth-1],' / ');
   IF NOT public.campus_venue_available(parent) THEN
    RETURN jsonb_build_object('ok',false,'error','Choose an active parent building or floor.');
   END IF;
  END IF;
  IF EXISTS(SELECT FROM public.campus_venues WHERE lower(label)=lower(target))
    OR (p_action='rename' AND (depth<>cardinality(string_to_array(p_label,' / '))
      OR starts_with(target,p_label||' / '))) THEN
   RETURN jsonb_build_object('ok',false,'error','Choose a new name at the same location level.');
  END IF;
  IF p_action='create' THEN
   INSERT INTO public.campus_venues(label) VALUES(target);
  ELSE
   IF EXISTS(SELECT FROM public.campus_venues old
      WHERE starts_with(old.label,p_label||' / ') AND
       (length(target||substr(old.label,length(p_label)+1))>80 OR
        EXISTS(SELECT FROM public.campus_venues other WHERE
         lower(other.label)=lower(target||substr(old.label,length(p_label)+1))))) THEN
    RETURN jsonb_build_object('ok',false,'error','A renamed child would conflict or exceed 80 characters.');
   END IF;
   INSERT INTO public.campus_venues(label,active)
    SELECT target||substr(label,length(p_label)+1),active FROM public.campus_venues
     WHERE label=p_label OR starts_with(label,p_label||' / ');
   UPDATE public.campus_venues SET active=false,version=version+1
    WHERE label=p_label OR starts_with(label,p_label||' / ');
  END IF;
 END IF;
 INSERT INTO public.campus_venue_history(actor_id,action,previous_label,label)
 VALUES(p_actor,p_action,CASE WHEN p_action='create' THEN NULL ELSE p_label END,target);
 RETURN jsonb_build_object('ok',true,'label',target);
END $$;
REVOKE ALL ON FUNCTION public.campus_venue_manage(uuid,text,text,text,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campus_venue_manage(uuid,text,text,text,boolean,integer) TO service_role;
COMMIT;
