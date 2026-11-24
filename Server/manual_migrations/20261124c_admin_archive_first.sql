-- User-applied. Preserve records, relationships, storage and custody while archiving.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS archived_at timestamptz,
 ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;
ALTER TABLE public.smart_tags ADD COLUMN IF NOT EXISTS archived_at timestamptz,
 ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION public.admin_archive_tag_batch(p_batch uuid,p_actor uuid,p_archived boolean)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE total integer;
BEGIN
 PERFORM 1 FROM public.user_profiles WHERE account_id=p_actor AND is_active AND access_level='super_admin'
 AND (suspended_until IS NULL OR suspended_until<=now()) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active super administrator required'; END IF;
 PERFORM 1 FROM public.smart_tags WHERE batch_id=p_batch ORDER BY tag_id FOR UPDATE;
 IF p_archived AND EXISTS(SELECT FROM public.smart_tags WHERE batch_id=p_batch AND status<>'blank' AND NOT is_disabled)
 THEN RAISE EXCEPTION 'Deactivate registered tags before archiving the batch'; END IF;
 UPDATE public.smart_tags SET archived_at=CASE WHEN p_archived THEN coalesce(archived_at,now()) ELSE NULL END,
 archived_by=CASE WHEN p_archived THEN p_actor ELSE NULL END WHERE batch_id=p_batch;
 GET DIAGNOSTICS total=ROW_COUNT;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.admin_archive_tag_batch(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_tag_batch(uuid,uuid,boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.admin_delete_archived_found_item(p_item_reference text,p_admin_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.found_items WHERE fpost_id=p_item_reference AND archived_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Archive the found report first'; END IF;
 RETURN public.admin_delete_found_item(p_item_reference,p_admin_id);
END $$;
CREATE OR REPLACE FUNCTION public.admin_delete_archived_missing_item(p_item_reference text,p_admin_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.missing_items WHERE mpost_id=p_item_reference AND archived_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Archive the lost report first'; END IF;
 RETURN public.admin_delete_missing_item(p_item_reference,p_admin_id);
END $$;
CREATE OR REPLACE FUNCTION public.admin_delete_archived_claim(p_claim_id uuid,p_admin_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.claims WHERE claim_id=p_claim_id AND archived_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Archive the claim first'; END IF;
 RETURN public.admin_delete_claim(p_claim_id,p_admin_id);
END $$;
CREATE OR REPLACE FUNCTION public.admin_delete_archived_user(p_target_account_id uuid,p_admin_id uuid,p_totp_step bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.user_profiles WHERE account_id=p_target_account_id AND archived_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Archive the account first'; END IF;
 RETURN public.admin_delete_user(p_target_account_id,p_admin_id,p_totp_step);
END $$;
REVOKE ALL ON FUNCTION public.admin_delete_archived_found_item(text,uuid),public.admin_delete_archived_missing_item(text,uuid),
 public.admin_delete_archived_claim(uuid,uuid),public.admin_delete_archived_user(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_archived_found_item(text,uuid),public.admin_delete_archived_missing_item(text,uuid),
 public.admin_delete_archived_claim(uuid,uuid),public.admin_delete_archived_user(uuid,uuid,bigint) TO service_role;
CREATE OR REPLACE FUNCTION public.admin_archived_activation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.archived_at IS NOT NULL THEN
  IF TG_TABLE_NAME='user_profiles' AND (to_jsonb(NEW)->>'is_active')::boolean THEN
   RAISE EXCEPTION 'Restore the archived account before activation'; END IF;
  IF TG_TABLE_NAME='smart_tags' AND to_jsonb(NEW)->>'status'<>'blank' AND NOT (to_jsonb(NEW)->>'is_disabled')::boolean THEN
   RAISE EXCEPTION 'Deactivate registered tags before archival. Restore before activation'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_admin_archived_activation ON public.user_profiles;
CREATE TRIGGER trg_admin_archived_activation BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.admin_archived_activation_guard();
DROP TRIGGER IF EXISTS trg_admin_archived_activation ON public.smart_tags;
CREATE TRIGGER trg_admin_archived_activation BEFORE UPDATE ON public.smart_tags
FOR EACH ROW EXECUTE FUNCTION public.admin_archived_activation_guard();
CREATE OR REPLACE FUNCTION public.admin_event_delete_archive_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND OLD.status<>'archived'
 THEN RAISE EXCEPTION 'Archive the event before moving it to Deleted'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_admin_event_delete_archive ON public.event_workspaces;
CREATE TRIGGER trg_admin_event_delete_archive BEFORE UPDATE ON public.event_workspaces
FOR EACH ROW EXECUTE FUNCTION public.admin_event_delete_archive_guard();
CREATE OR REPLACE FUNCTION public.admin_archive_draft_event(p_event_id uuid,p_actor_id uuid,p_version integer,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE e public.event_workspaces%ROWTYPE;
BEGIN
 SELECT * INTO STRICT e FROM public.event_workspaces WHERE event_id=p_event_id FOR UPDATE;
 PERFORM 1 FROM public.user_profiles WHERE account_id=p_actor_id AND is_active AND access_level='super_admin'
 AND (suspended_until IS NULL OR suspended_until<=now()) FOR SHARE;
 IF NOT FOUND OR e.status<>'draft' OR e.version<>p_version OR e.deleted_at IS NOT NULL
 OR length(trim(coalesce(p_note,''))) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Draft changed or archive access denied'; END IF;
 UPDATE public.event_workspaces SET status='archived',portal_enabled=false,version=version+1,updated_at=now()
 WHERE event_id=p_event_id RETURNING * INTO e;
 INSERT INTO public.event_state_history(event_id,actor_id,from_status,to_status,note)
 VALUES(p_event_id,p_actor_id,'draft','archived','Archive: '||p_note);
 RETURN jsonb_build_object('ok',true,'event',to_jsonb(e));
END $$;
REVOKE ALL ON FUNCTION public.admin_archive_draft_event(uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_draft_event(uuid,uuid,integer,text) TO service_role;
CREATE OR REPLACE FUNCTION public.admin_restore_archived_event(p_event_id uuid,p_actor_id uuid,p_version integer,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE e public.event_workspaces%ROWTYPE; target text;
BEGIN
 SELECT * INTO STRICT e FROM public.event_workspaces WHERE event_id=p_event_id FOR UPDATE;
 PERFORM 1 FROM public.user_profiles WHERE account_id=p_actor_id AND is_active AND access_level='super_admin'
 AND (suspended_until IS NULL OR suspended_until<=now()) FOR SHARE;
 IF NOT FOUND OR e.status<>'archived' OR e.version<>p_version OR e.deleted_at IS NOT NULL
 OR length(trim(coalesce(p_note,''))) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Archive changed or restore access denied'; END IF;
 SELECT from_status INTO target FROM public.event_state_history WHERE event_id=p_event_id AND to_status='archived'
 AND from_status IN ('draft','closed','cancelled') ORDER BY created_at DESC LIMIT 1;
 IF target IS NULL THEN RAISE EXCEPTION 'Original archive state could not be verified'; END IF;
 UPDATE public.event_workspaces SET status=target,portal_enabled=false,version=version+1,updated_at=now()
 WHERE event_id=p_event_id RETURNING * INTO e;
 INSERT INTO public.event_state_history(event_id,actor_id,from_status,to_status,note)
 VALUES(p_event_id,p_actor_id,'archived',target,'Restore archive: '||p_note);
 RETURN jsonb_build_object('ok',true,'event',to_jsonb(e));
END $$;
REVOKE ALL ON FUNCTION public.admin_restore_archived_event(uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restore_archived_event(uuid,uuid,integer,text) TO service_role;
INSERT INTO public.migration_log(name,note) VALUES('20261124c_admin_archive_first','Require archival before admin record deletion') ON CONFLICT(name) DO NOTHING;
COMMIT;
