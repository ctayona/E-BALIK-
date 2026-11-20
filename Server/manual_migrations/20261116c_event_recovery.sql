-- USER-RUN ONLY after 20261116b_event_reports. No campus report/claim/ledger changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.migration_log WHERE name='20261116b_event_reports') THEN RAISE EXCEPTION 'Event reports migration required.'; END IF;
  IF EXISTS(SELECT 1 FROM public.migration_log WHERE name='20261116c_event_recovery')
    OR to_regclass('public.event_claims') IS NOT NULL OR to_regclass('public.event_claim_history') IS NOT NULL
    OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND ((table_name='event_workspaces' AND column_name='deleted_at') OR (table_name='event_reports' AND column_name='released_at')))
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('event_claim_command','event_manage_workspace','event_workspace_guard','event_close_claims','event_released_guard')) THEN
    RAISE EXCEPTION 'Recovery objects already exist. Verify instead of overwriting.';
  END IF;
END $$;
ALTER TABLE public.event_workspaces ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;
ALTER TABLE public.event_reports ADD COLUMN released_at TIMESTAMPTZ,
  ADD COLUMN released_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  ADD CONSTRAINT event_release_received CHECK(released_at IS NULL OR (kind='found' AND received_at IS NOT NULL AND withdrawn_at IS NULL AND released_at>=received_at));
CREATE INDEX idx_event_workspace_deleted ON public.event_workspaces(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_event_report_releaser ON public.event_reports(released_by);
CREATE INDEX idx_event_workspace_deleter ON public.event_workspaces(deleted_by);
CREATE TABLE public.event_claims (
  claim_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  report_id UUID NOT NULL,
  claimant_account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  request_id UUID NOT NULL,
  evidence VARCHAR(2000) NOT NULL CHECK(length(btrim(evidence)) BETWEEN 20 AND 2000),
  proof_path VARCHAR(255),
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn','expired','released')),
  decision_note VARCHAR(1000),
  reviewed_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  pin_hash VARCHAR(64),
  pin_encrypted TEXT,
  pin_issued_at TIMESTAMPTZ,
  pickup_expires_at TIMESTAMPTZ,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 5),
  released_at TIMESTAMPTZ,
  released_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  recipient_name VARCHAR(160),
  receipt_item_label VARCHAR(120),
  receipt_event_name VARCHAR(120),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(event_id,report_id) REFERENCES public.event_reports(event_id,report_id) ON DELETE RESTRICT,
  UNIQUE(event_id,claim_id), UNIQUE(event_id,claimant_account_id,request_id),
  CHECK(proof_path IS NULL OR proof_path ~ ('^'||event_id::text||'/claims/'||claim_id::text||'/[0-9a-f]{32}\.webp$')),
  CHECK(pin_hash IS NULL OR pin_hash ~ '^[0-9a-f]{64}$'),
  CHECK(status<>'approved' OR (pin_hash IS NOT NULL AND pin_encrypted IS NOT NULL AND pin_issued_at IS NOT NULL AND pickup_expires_at IS NOT NULL)),
  CHECK(status<>'released' OR (released_at IS NOT NULL AND recipient_name IS NOT NULL AND receipt_item_label IS NOT NULL AND receipt_event_name IS NOT NULL)),
  CHECK(status='approved' OR (pin_hash IS NULL AND pin_encrypted IS NULL))
);
CREATE UNIQUE INDEX idx_event_claim_open_owner ON public.event_claims(event_id,report_id,claimant_account_id) WHERE status IN ('pending','approved');
CREATE UNIQUE INDEX idx_event_claim_winner ON public.event_claims(event_id,report_id) WHERE status IN ('approved','released');
CREATE INDEX idx_event_claim_owner ON public.event_claims(claimant_account_id,event_id,created_at DESC);
CREATE INDEX idx_event_claim_report ON public.event_claims(event_id,report_id,created_at DESC);
CREATE INDEX idx_event_claim_reviewer ON public.event_claims(reviewed_by);
CREATE INDEX idx_event_claim_releaser ON public.event_claims(released_by);
CREATE TABLE public.event_claim_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  claim_id UUID NOT NULL,
  actor_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
  action VARCHAR(16) NOT NULL CHECK(action IN ('created','approved','rejected','withdrawn','expired','pin_reset','pin_failed','released')),
  note VARCHAR(1000) NOT NULL CHECK(length(btrim(note)) BETWEEN 5 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(event_id,claim_id) REFERENCES public.event_claims(event_id,claim_id) ON DELETE RESTRICT
);
CREATE INDEX idx_event_claim_history_claim ON public.event_claim_history(event_id,claim_id,created_at DESC);
CREATE INDEX idx_event_claim_history_actor ON public.event_claim_history(actor_id);
ALTER TABLE public.event_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_claim_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_claims,public.event_claim_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.event_claims TO service_role;
GRANT SELECT,INSERT ON public.event_claim_history TO service_role;

CREATE FUNCTION public.event_workspace_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND ((to_jsonb(NEW)-ARRAY['deleted_at','deleted_by','created_by','portal_enabled','updated_at','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['deleted_at','deleted_by','created_by','portal_enabled','updated_at','version']) OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL)) THEN
    RAISE EXCEPTION 'Restore the deleted event before changing it.';
  END IF;
  IF NEW.deleted_at IS NOT NULL AND (NEW.portal_enabled OR NEW.status NOT IN ('draft','closed','cancelled','archived')) THEN RAISE EXCEPTION 'Only inactive events with a closed portal can be deleted.'; END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM public.event_reports WHERE event_id=NEW.event_id AND received_at IS NOT NULL AND released_at IS NULL) THEN
    RAISE EXCEPTION 'This event still holds items in custody. Keep its recovery records available.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_event_workspace_guard BEFORE UPDATE ON public.event_workspaces FOR EACH ROW EXECUTE FUNCTION public.event_workspace_guard();
CREATE FUNCTION public.event_close_claims() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE changed RECORD;
BEGIN
  IF NEW.status IN ('closed','cancelled','archived') OR NEW.deleted_at IS NOT NULL THEN
    FOR changed IN UPDATE public.event_claims SET status='expired',pin_hash=NULL,pin_encrypted=NULL,version=version+1,updated_at=clock_timestamp()
      WHERE event_id=NEW.event_id AND status IN ('pending','approved') RETURNING claim_id LOOP
      INSERT INTO public.event_claim_history(event_id,claim_id,action,note) VALUES(NEW.event_id,changed.claim_id,'expired','Event closed, archived, cancelled or deleted; pickup access ended.');
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_event_close_claims AFTER UPDATE OF status,deleted_at ON public.event_workspaces FOR EACH ROW EXECUTE FUNCTION public.event_close_claims();
CREATE FUNCTION public.event_released_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.released_at IS NOT NULL AND ((to_jsonb(NEW)-ARRAY['updated_at','version','released_by','received_by','reporter_account_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','version','released_by','received_by','reporter_account_id'])
    OR (NEW.reporter_account_id IS DISTINCT FROM OLD.reporter_account_id AND NEW.reporter_account_id IS NOT NULL)
    OR (NEW.received_by IS DISTINCT FROM OLD.received_by AND NEW.received_by IS NOT NULL)
    OR (NEW.released_by IS DISTINCT FROM OLD.released_by AND NEW.released_by IS NOT NULL)) THEN RAISE EXCEPTION 'Released report facts cannot be changed.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_event_released_guard BEFORE UPDATE ON public.event_reports FOR EACH ROW EXECUTE FUNCTION public.event_released_guard();

CREATE FUNCTION public.event_manage_workspace(p_event_id UUID,p_actor_id UUID,p_version INTEGER,p_action TEXT,p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE e public.event_workspaces%ROWTYPE; old_status TEXT; stamp TIMESTAMPTZ;
BEGIN
  SELECT * INTO e FROM public.event_workspaces WHERE event_id=p_event_id FOR UPDATE;
  stamp:=clock_timestamp();
  IF NOT FOUND OR e.version IS DISTINCT FROM p_version THEN RETURN jsonb_build_object('ok',false,'error','Event changed or was not found. Refresh.'); END IF;
  PERFORM 1 FROM public.user_profiles WHERE account_id=p_actor_id AND is_active IS TRUE AND access_level='super_admin' AND (suspended_until IS NULL OR suspended_until<=stamp) FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Active super administrator required.'); END IF;
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 5 AND 1000 OR p_note ~ '[<>[:cntrl:]]' THEN RETURN jsonb_build_object('ok',false,'error','Enter a plain-text reason of 5-1000 characters.'); END IF;
  old_status:=e.status;
  IF p_action='archive' AND e.deleted_at IS NULL AND e.status IN ('closed','cancelled') THEN
    UPDATE public.event_workspaces SET status='archived',portal_enabled=false,version=version+1,updated_at=stamp WHERE event_id=p_event_id RETURNING * INTO e;
  ELSIF p_action='delete' AND e.deleted_at IS NULL AND e.status IN ('draft','closed','cancelled','archived') THEN
    IF EXISTS(SELECT 1 FROM public.event_reports WHERE event_id=p_event_id AND received_at IS NOT NULL AND released_at IS NULL) THEN RETURN jsonb_build_object('ok',false,'error','Deletion blocked: unreleased items remain in desk custody.'); END IF;
    UPDATE public.event_workspaces SET deleted_at=stamp,deleted_by=p_actor_id,portal_enabled=false,version=version+1,updated_at=stamp WHERE event_id=p_event_id RETURNING * INTO e;
  ELSIF p_action='restore' AND e.deleted_at IS NOT NULL THEN
    UPDATE public.event_workspaces SET deleted_at=NULL,deleted_by=NULL,portal_enabled=false,version=version+1,updated_at=stamp WHERE event_id=p_event_id RETURNING * INTO e;
  ELSE RETURN jsonb_build_object('ok',false,'error','This management action is not available for the current event state.'); END IF;
  INSERT INTO public.event_state_history(event_id,actor_id,from_status,to_status,note,created_at) VALUES(p_event_id,p_actor_id,old_status,e.status,initcap(p_action)||': '||left(btrim(p_note),980),stamp);
  RETURN jsonb_build_object('ok',true,'event',to_jsonb(e));
END $$;

CREATE FUNCTION public.event_claim_command(p_event_id UUID,p_actor_id UUID,p_claim_id UUID,p_action TEXT,p_version INTEGER,p_data JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE e public.event_workspaces%ROWTYPE; r public.event_reports%ROWTYPE; c public.event_claims%ROWTYPE;
  u public.user_profiles%ROWTYPE; claimant public.user_profiles%ROWTYPE; m public.event_memberships%ROWTYPE;
  staff BOOLEAN:=false; stamp TIMESTAMPTZ; memo TEXT; changed RECORD; request_key UUID;
BEGIN
  SELECT * INTO e FROM public.event_workspaces WHERE event_id=p_event_id FOR UPDATE;
  IF NOT FOUND OR e.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','Event is unavailable.'); END IF;
  SELECT * INTO u FROM public.user_profiles WHERE account_id=p_actor_id FOR SHARE;
  stamp:=clock_timestamp();
  IF NOT FOUND OR u.is_active IS NOT TRUE OR (u.suspended_until IS NOT NULL AND u.suspended_until>stamp) THEN RETURN jsonb_build_object('ok',false,'error','Active account required.'); END IF;
  SELECT * INTO m FROM public.event_memberships WHERE event_id=p_event_id AND account_id=p_actor_id FOR SHARE;
  staff:=FOUND AND m.status='active' AND m.role IN ('manager','desk_staff') AND m.starts_at<=stamp AND stamp<m.expires_at;
  IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RETURN jsonb_build_object('ok',false,'error','Invalid claim payload.'); END IF;
  IF p_action='create' THEN
    IF u.verification_status IS DISTINCT FROM 'verified' OR p_data - ARRAY['report_id','request_id','evidence','proof_path'] <> '{}'::jsonb THEN RETURN jsonb_build_object('ok',false,'error','Verified account and valid claim form required.'); END IF;
    request_key:=(p_data->>'request_id')::uuid;
    IF request_key IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Claim request reference required.'); END IF;
    SELECT * INTO c FROM public.event_claims WHERE event_id=p_event_id AND claimant_account_id=p_actor_id AND request_id=request_key;
    IF FOUND THEN RETURN jsonb_build_object('ok',true,'claim',to_jsonb(c),'replayed',true); END IF;
  END IF;
  IF e.status NOT IN ('active','recovery') OR e.starts_at IS NULL OR e.starts_at>stamp OR e.recovery_ends_at IS NULL OR e.recovery_ends_at<=stamp THEN RETURN jsonb_build_object('ok',false,'error','The event recovery window is closed.'); END IF;
  IF p_action='create' THEN
    SELECT * INTO r FROM public.event_reports WHERE event_id=p_event_id AND report_id=(p_data->>'report_id')::uuid FOR UPDATE;
    IF NOT FOUND OR r.kind<>'found' OR r.moderation_status<>'approved' OR r.withdrawn_at IS NOT NULL OR r.released_at IS NOT NULL OR e.portal_enabled IS NOT TRUE OR r.reporter_account_id=p_actor_id THEN RETURN jsonb_build_object('ok',false,'error','This item cannot accept an ownership claim from your account.'); END IF;
    IF p_data->>'evidence' IS NULL OR length(btrim(p_data->>'evidence')) NOT BETWEEN 20 AND 2000 OR p_data->>'evidence' ~ '[<>[:cntrl:]]' THEN RETURN jsonb_build_object('ok',false,'error','Provide private ownership evidence of 20-2000 characters.'); END IF;
    FOR changed IN UPDATE public.event_claims SET status='expired',pin_hash=NULL,pin_encrypted=NULL,version=version+1,updated_at=stamp WHERE event_id=p_event_id AND report_id=r.report_id AND status='approved' AND pickup_expires_at<=stamp RETURNING claim_id LOOP
      INSERT INTO public.event_claim_history(event_id,claim_id,actor_id,action,note,created_at) VALUES(p_event_id,changed.claim_id,p_actor_id,'expired','Previous pickup approval expired before a new ownership request.',stamp);
    END LOOP;
    IF (SELECT count(*) FROM public.event_claims WHERE event_id=p_event_id AND claimant_account_id=p_actor_id AND created_at>=stamp-interval '1 day')>=10 THEN RETURN jsonb_build_object('ok',false,'error','Daily event claim limit reached. Contact the collection desk.'); END IF;
    IF EXISTS(SELECT 1 FROM public.event_claims WHERE event_id=p_event_id AND report_id=r.report_id AND claimant_account_id=p_actor_id AND status IN ('pending','approved')) THEN RETURN jsonb_build_object('ok',false,'error','You already have an open claim for this item.'); END IF;
    INSERT INTO public.event_claims(claim_id,event_id,report_id,claimant_account_id,request_id,evidence,proof_path,created_at,updated_at)
      VALUES(p_claim_id,p_event_id,r.report_id,p_actor_id,request_key,btrim(p_data->>'evidence'),p_data->>'proof_path',stamp,stamp) RETURNING * INTO c;
    INSERT INTO public.event_claim_history(event_id,claim_id,actor_id,action,note,created_at) VALUES(p_event_id,c.claim_id,p_actor_id,'created','Ownership claim submitted for manager review.',stamp);
    RETURN jsonb_build_object('ok',true,'claim',to_jsonb(c),'replayed',false);
  END IF;
  SELECT * INTO c FROM public.event_claims WHERE event_id=p_event_id AND claim_id=p_claim_id FOR UPDATE;
  IF NOT FOUND OR c.version IS DISTINCT FROM p_version THEN RETURN jsonb_build_object('ok',false,'error','Claim changed or was not found. Refresh before continuing.'); END IF;
  SELECT * INTO r FROM public.event_reports WHERE event_id=p_event_id AND report_id=c.report_id FOR UPDATE;
  IF p_action='withdraw' THEN
    IF c.claimant_account_id IS DISTINCT FROM p_actor_id OR c.status NOT IN ('pending','approved') OR p_data<>'{}'::jsonb THEN RETURN jsonb_build_object('ok',false,'error','Only your own open claim can be withdrawn.'); END IF;
    UPDATE public.event_claims SET status='withdrawn',pin_hash=NULL,pin_encrypted=NULL,version=version+1,updated_at=stamp WHERE claim_id=c.claim_id RETURNING * INTO c;
    memo:='Claimant withdrew the ownership request.';
  ELSIF p_action IN ('approve','reject') THEN
    IF staff IS NOT TRUE OR m.role<>'manager' OR p_actor_id=c.claimant_account_id OR c.status NOT IN ('pending','approved') OR p_data - ARRAY['note','pin_hash','pin_encrypted'] <> '{}'::jsonb THEN RETURN jsonb_build_object('ok',false,'error','An assigned event manager other than the claimant must review this open claim.'); END IF;
    memo:=btrim(p_data->>'note');
    IF memo IS NULL OR length(memo) NOT BETWEEN 5 AND 1000 OR memo ~ '[<>[:cntrl:]]' THEN RETURN jsonb_build_object('ok',false,'error','A plain-text decision reason of 5-1000 characters is required.'); END IF;
    IF p_action='approve' THEN
      SELECT * INTO claimant FROM public.user_profiles WHERE account_id=c.claimant_account_id FOR SHARE;
      IF NOT FOUND OR claimant.is_active IS NOT TRUE OR claimant.verification_status IS DISTINCT FROM 'verified' OR (claimant.suspended_until IS NOT NULL AND claimant.suspended_until>stamp)
        OR c.status<>'pending' OR r.received_at IS NULL OR r.released_at IS NOT NULL OR r.withdrawn_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','Receive the item and verify an active claimant before approval.'); END IF;
      IF p_data->>'pin_hash' IS NULL OR p_data->>'pin_hash' !~ '^[0-9a-f]{64}$' OR p_data->>'pin_encrypted' IS NULL OR length(p_data->>'pin_encrypted') NOT BETWEEN 40 AND 500 THEN RETURN jsonb_build_object('ok',false,'error','Server-generated pickup credentials are required.'); END IF;
      FOR changed IN UPDATE public.event_claims SET status='expired',pin_hash=NULL,pin_encrypted=NULL,version=version+1,updated_at=stamp WHERE event_id=p_event_id AND report_id=r.report_id AND status='approved' AND pickup_expires_at<=stamp RETURNING claim_id LOOP
        INSERT INTO public.event_claim_history(event_id,claim_id,actor_id,action,note,created_at) VALUES(p_event_id,changed.claim_id,p_actor_id,'expired','Pickup code expired before another ownership decision.',stamp);
      END LOOP;
      IF EXISTS(SELECT 1 FROM public.event_claims WHERE event_id=p_event_id AND report_id=r.report_id AND status IN ('approved','released')) THEN RETURN jsonb_build_object('ok',false,'error','Another claim already holds pickup approval for this item.'); END IF;
      UPDATE public.event_claims SET status='approved',decision_note=memo,reviewed_at=stamp,reviewed_by=p_actor_id,pin_hash=p_data->>'pin_hash',pin_encrypted=p_data->>'pin_encrypted',pin_issued_at=stamp,pickup_expires_at=LEAST(stamp+interval '24 hours',e.recovery_ends_at),failed_attempts=0,version=version+1,updated_at=stamp WHERE claim_id=c.claim_id RETURNING * INTO c;
    ELSE UPDATE public.event_claims SET status='rejected',decision_note=memo,reviewed_at=stamp,reviewed_by=p_actor_id,pin_hash=NULL,pin_encrypted=NULL,version=version+1,updated_at=stamp WHERE claim_id=c.claim_id RETURNING * INTO c;
    END IF;
  ELSIF p_action='reset_pin' THEN
    IF c.claimant_account_id IS DISTINCT FROM p_actor_id OR c.status<>'approved' OR c.pickup_expires_at<=stamp OR c.pin_issued_at>stamp-interval '1 minute' OR p_data - ARRAY['pin_hash','pin_encrypted'] <> '{}'::jsonb THEN RETURN jsonb_build_object('ok',false,'error','Only the claimant can replace an unexpired pickup code, at most once per minute.'); END IF;
    IF p_data->>'pin_hash' IS NULL OR p_data->>'pin_hash' !~ '^[0-9a-f]{64}$' OR p_data->>'pin_hash'=c.pin_hash OR p_data->>'pin_encrypted' IS NULL OR length(p_data->>'pin_encrypted') NOT BETWEEN 40 AND 500 THEN RETURN jsonb_build_object('ok',false,'error','New server-generated pickup credentials required.'); END IF;
    UPDATE public.event_claims SET pin_hash=p_data->>'pin_hash',pin_encrypted=p_data->>'pin_encrypted',pin_issued_at=stamp,failed_attempts=0,version=version+1,updated_at=stamp WHERE claim_id=c.claim_id RETURNING * INTO c;
    memo:='Claimant replaced the pickup code; the previous code is invalid.';
  ELSIF p_action='release' THEN
    IF staff IS NOT TRUE OR p_actor_id=c.claimant_account_id OR c.status<>'approved' OR c.pickup_expires_at<=stamp OR c.failed_attempts>=5 OR r.kind<>'found' OR r.received_at IS NULL OR r.released_at IS NOT NULL
      OR p_data - ARRAY['pin_hash','note','identity_checked'] <> '{}'::jsonb OR p_data->'identity_checked' IS DISTINCT FROM 'true'::jsonb THEN RETURN jsonb_build_object('ok',false,'error','Valid pickup approval, current staff assignment and in-person identity check are required.'); END IF;
    SELECT * INTO claimant FROM public.user_profiles WHERE account_id=c.claimant_account_id FOR SHARE;
    IF NOT FOUND OR claimant.is_active IS NOT TRUE OR claimant.verification_status IS DISTINCT FROM 'verified' OR (claimant.suspended_until IS NOT NULL AND claimant.suspended_until>stamp) THEN RETURN jsonb_build_object('ok',false,'error','Claimant account access must be restored before pickup.'); END IF;
    memo:=btrim(p_data->>'note');
    IF memo IS NULL OR length(memo) NOT BETWEEN 5 AND 1000 OR memo ~ '[<>[:cntrl:]]' OR p_data->>'pin_hash' IS NULL OR p_data->>'pin_hash' !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'error','Pickup code and release note required.'); END IF;
    IF p_data->>'pin_hash'<>c.pin_hash THEN
      UPDATE public.event_claims SET failed_attempts=failed_attempts+1,version=version+1,updated_at=stamp WHERE claim_id=c.claim_id;
      INSERT INTO public.event_claim_history(event_id,claim_id,actor_id,action,note,created_at) VALUES(p_event_id,c.claim_id,p_actor_id,'pin_failed','Incorrect pickup code; attempt recorded.',stamp);
      RETURN jsonb_build_object('ok',false,'error','Incorrect pickup code. Refresh before retrying; five failed attempts lock this code.','code','pin_incorrect');
    END IF;
    UPDATE public.event_reports SET released_at=stamp,released_by=p_actor_id,version=version+1,updated_at=stamp WHERE report_id=r.report_id;
    UPDATE public.event_claims SET status='released',released_at=stamp,released_by=p_actor_id,recipient_name=left(COALESCE(NULLIF(btrim(COALESCE(claimant.fname,'')||' '||COALESCE(claimant.lname,'')),''),'Verified claimant'),160),receipt_item_label=left(COALESCE(r.public_label,r.category),120),receipt_event_name=e.name,pin_hash=NULL,pin_encrypted=NULL,version=version+1,updated_at=stamp WHERE claim_id=c.claim_id RETURNING * INTO c;
    INSERT INTO public.event_report_history(event_id,report_id,actor_id,action,note,created_at) VALUES(p_event_id,r.report_id,p_actor_id,'note','Item released under an approved event ownership claim.',stamp);
    FOR changed IN UPDATE public.event_claims SET status='rejected',decision_note='Item released under another approved ownership claim.',pin_hash=NULL,pin_encrypted=NULL,version=version+1,updated_at=stamp WHERE event_id=p_event_id AND report_id=r.report_id AND claim_id<>c.claim_id AND status IN ('pending','approved') RETURNING claim_id LOOP
      INSERT INTO public.event_claim_history(event_id,claim_id,actor_id,action,note,created_at) VALUES(p_event_id,changed.claim_id,p_actor_id,'rejected','Item released under another approved ownership claim.',stamp);
    END LOOP;
  ELSE RETURN jsonb_build_object('ok',false,'error','Unknown event claim action.'); END IF;
  INSERT INTO public.event_claim_history(event_id,claim_id,actor_id,action,note,created_at) VALUES(p_event_id,c.claim_id,p_actor_id,CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' WHEN 'reset_pin' THEN 'pin_reset' WHEN 'withdraw' THEN 'withdrawn' ELSE 'released' END,memo,stamp);
  RETURN jsonb_build_object('ok',true,'claim',to_jsonb(c));
EXCEPTION WHEN unique_violation OR invalid_text_representation OR not_null_violation OR check_violation OR string_data_right_truncation THEN RETURN jsonb_build_object('ok',false,'error','Claim changed, conflicts with another open claim, or has invalid fields. Refresh before retrying.');
END $$;
REVOKE ALL ON FUNCTION public.event_manage_workspace(UUID,UUID,INTEGER,TEXT,TEXT),public.event_claim_command(UUID,UUID,UUID,TEXT,INTEGER,JSONB),public.event_workspace_guard(),public.event_close_claims(),public.event_released_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_manage_workspace(UUID,UUID,INTEGER,TEXT,TEXT),public.event_claim_command(UUID,UUID,UUID,TEXT,INTEGER,JSONB),public.event_workspace_guard(),public.event_close_claims(),public.event_released_guard() TO service_role;
INSERT INTO public.migration_log(name,note) VALUES('20261116c_event_recovery','Isolated event ownership claims, audited pickup/release, receipts, recoverable deletion and archival guards');
COMMIT;
