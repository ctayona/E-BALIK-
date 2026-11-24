-- User-applied Phase 8. No existing event/payment rows are rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.migration_log WHERE name='20261124_event_smart_tags')
 THEN RAISE EXCEPTION 'Install the reusable event tag migration first'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.event_rental_packages (
 package_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name varchar(100) NOT NULL CHECK(length(trim(name))>=3),
 price numeric(12,2) NOT NULL CHECK(price BETWEEN 0 AND 1000000),
 included_tags integer NOT NULL CHECK(included_tags BETWEEN 0 AND 10000),
 duration_hours integer NOT NULL CHECK(duration_hours BETWEEN 1 AND 8760),
 support varchar(500) NOT NULL, terms varchar(1000) NOT NULL CHECK(length(trim(terms))>=8),
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.event_rental_bookings (
 booking_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.event_workspaces,
 package_id uuid NOT NULL REFERENCES public.event_rental_packages,
 payer_id uuid REFERENCES public.user_profiles ON DELETE SET NULL,
 organizer varchar(120) NOT NULL, quote jsonb NOT NULL,
 amount numeric(12,2) NOT NULL CHECK(amount BETWEEN 0 AND 1000000),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 status text NOT NULL CHECK(status IN ('awaiting_payment','paid','complimentary','cancelled','refunded')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid REFERENCES public.user_profiles ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_current_booking ON public.event_rental_bookings(event_id)
 WHERE status IN ('awaiting_payment','paid','complimentary');
CREATE TABLE IF NOT EXISTS public.event_rental_history (
 request_id uuid PRIMARY KEY, actor_id uuid REFERENCES public.user_profiles ON DELETE SET NULL,
 action text NOT NULL, fingerprint jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_rental_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_rental_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_rental_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_rental_packages,public.event_rental_bookings,public.event_rental_history FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.event_rental_packages,public.event_rental_bookings TO service_role;
GRANT SELECT,INSERT ON public.event_rental_history TO service_role;
-- Existing allowed sources are preserved. The new source has its own receipt and source record.
ALTER TABLE public.income_ledger DROP CONSTRAINT IF EXISTS income_ledger_source_check;
ALTER TABLE public.income_ledger ADD CONSTRAINT income_ledger_source_check
 CHECK(source IN ('auction','smart_tag','other','event_rental'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_sale_receipt ON public.income_ledger(receipt_no)
 WHERE source='event_rental' AND kind='sale';
ALTER TABLE public.payment_proofs DROP CONSTRAINT IF EXISTS payment_proofs_source_check;
ALTER TABLE public.payment_proofs ADD CONSTRAINT payment_proofs_source_check CHECK(source IN ('auction','smart_tag','event_rental'));

CREATE OR REPLACE FUNCTION public.event_rental_command(p_actor uuid,p_request uuid,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE actor public.user_profiles%ROWTYPE; e public.event_workspaces%ROWTYPE;
 p public.event_rental_packages%ROWTYPE; b public.event_rental_bookings%ROWTYPE;
 old public.event_rental_history%ROWTYPE; sale public.income_ledger%ROWTYPE;
 result jsonb; entry uuid; identifier uuid; number text; ref text; duration numeric;
BEGIN
 IF p_request IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Request reference and details required'; END IF;
 IF p_action IN ('confirm','cancel','refund') AND (p_data->>'version') IS NULL THEN RAISE EXCEPTION 'Booking version required'; END IF;
 IF p_action='book' AND ((p_data->>'package_version') IS NULL OR length(coalesce(trim(p_data->>'note'),''))<8)
 THEN RAISE EXCEPTION 'Package version and agreement required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 SELECT * INTO STRICT actor FROM public.user_profiles WHERE account_id=p_actor AND access_level='super_admin'
 AND is_active IS TRUE AND (suspended_until IS NULL OR suspended_until<=now()) FOR SHARE;
 SELECT * INTO old FROM public.event_rental_history WHERE request_id=p_request;
 IF FOUND THEN
  IF old.actor_id IS DISTINCT FROM p_actor OR old.action<>p_action OR old.fingerprint<>p_data
  THEN RAISE EXCEPTION 'Request reference already used for different details'; END IF;
  RETURN old.result;
 END IF;
 IF p_action='package' THEN
  IF (p_data->>'price')::numeric<0 OR (p_data->>'price')::numeric>1000000
   OR (p_data->>'price')::numeric<>round((p_data->>'price')::numeric,2) THEN RAISE EXCEPTION 'Invalid price'; END IF;
  IF p_data->>'package_id' IS NULL THEN
   INSERT INTO public.event_rental_packages(name,price,included_tags,duration_hours,support,terms)
   VALUES(p_data->>'name',(p_data->>'price')::numeric,(p_data->>'included_tags')::integer,
    (p_data->>'duration_hours')::integer,p_data->>'support',p_data->>'terms') RETURNING package_id INTO identifier;
  ELSE
   UPDATE public.event_rental_packages SET name=p_data->>'name',price=(p_data->>'price')::numeric,
    included_tags=(p_data->>'included_tags')::integer,duration_hours=(p_data->>'duration_hours')::integer,
    support=p_data->>'support',terms=p_data->>'terms',active=(p_data->>'active')::boolean,version=version+1
   WHERE package_id=(p_data->>'package_id')::uuid AND version=(p_data->>'version')::integer
   RETURNING package_id INTO identifier;
   IF identifier IS NULL THEN RAISE EXCEPTION 'Package changed. Refresh first'; END IF;
  END IF;
 ELSIF p_action='book' THEN
  SELECT * INTO STRICT e FROM public.event_workspaces WHERE event_id=(p_data->>'event_id')::uuid FOR UPDATE;
  IF e.deleted_at IS NOT NULL OR e.status NOT IN ('draft','scheduled') OR e.starts_at IS NULL OR e.ends_at IS NULL
  THEN RAISE EXCEPTION 'Book a saved draft or scheduled event with complete dates'; END IF;
  SELECT * INTO STRICT p FROM public.event_rental_packages WHERE package_id=(p_data->>'package_id')::uuid AND active FOR SHARE;
  IF p.version<>(p_data->>'package_version')::integer THEN RAISE EXCEPTION 'Package changed. Refresh first'; END IF;
  duration=extract(epoch FROM(e.ends_at-e.starts_at))/3600;
  IF duration<=0 OR duration>p.duration_hours THEN RAISE EXCEPTION 'Event exceeds package duration'; END IF;
  IF (SELECT count(*) FROM public.event_tag_allocations WHERE event_id=e.event_id AND ended_at IS NULL)>p.included_tags
  THEN RAISE EXCEPTION 'Existing tag allocation exceeds the selected package'; END IF;
  PERFORM 1 FROM public.user_profiles WHERE account_id=(p_data->>'payer_id')::uuid AND is_active IS TRUE
   AND (suspended_until IS NULL OR suspended_until<=now());
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active existing organizer account'; END IF;
  IF length(trim(p_data->>'note'))<8 THEN RAISE EXCEPTION 'Record organizer agreement or complimentary authorization'; END IF;
  INSERT INTO public.event_rental_bookings(event_id,package_id,payer_id,organizer,quote,amount,starts_at,ends_at,status,created_by)
  VALUES(e.event_id,p.package_id,(p_data->>'payer_id')::uuid,e.organizer_name,
   to_jsonb(p)||jsonb_build_object('agreement',p_data->>'note','event_name',e.name),p.price,e.starts_at,e.ends_at,
   CASE WHEN p.price=0 THEN 'complimentary' ELSE 'awaiting_payment' END,p_actor) RETURNING booking_id INTO identifier;
 ELSIF p_action IN ('confirm','cancel','refund') THEN
  SELECT event_id INTO STRICT identifier FROM public.event_rental_bookings WHERE booking_id=(p_data->>'booking_id')::uuid;
  SELECT * INTO STRICT e FROM public.event_workspaces WHERE event_id=identifier FOR UPDATE;
  SELECT * INTO STRICT b FROM public.event_rental_bookings WHERE booking_id=(p_data->>'booking_id')::uuid FOR UPDATE;
  IF b.version<>(p_data->>'version')::integer THEN RAISE EXCEPTION 'Booking changed. Refresh first'; END IF;
  identifier=b.booking_id;
  IF p_action='confirm' THEN
   IF b.status<>'awaiting_payment' OR e.deleted_at IS NOT NULL OR e.status IN ('cancelled','closed','archived')
    OR b.starts_at IS DISTINCT FROM e.starts_at OR b.ends_at IS DISTINCT FROM e.ends_at
   THEN RAISE EXCEPTION 'Booking is not payable. Check event state and agreed dates'; END IF;
   IF (p_data->>'amount')::numeric<>b.amount THEN RAISE EXCEPTION 'Amount changed'; END IF;
   IF p_data->>'method' NOT IN ('cash','gcash','maya','bank','other') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
   ref=nullif(trim(p_data->>'reference'),'');
   IF p_data->>'method' IN ('gcash','maya','bank') THEN
    IF length(coalesce(ref,''))<4 OR nullif(p_data->>'proof_path','') IS NULL THEN RAISE EXCEPTION 'Payment reference and private evidence required'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(lower(ref),1));
    IF EXISTS(SELECT FROM public.income_ledger WHERE kind='sale' AND lower(payment_reference)=lower(ref))
    THEN RAISE EXCEPTION 'Payment reference already recorded'; END IF;
   END IF;
   number='PR-'||to_char(now() AT TIME ZONE 'Asia/Manila','YYYYMMDD')||'-EV-'||upper(left(replace(b.booking_id::text,'-',''),24));
   INSERT INTO public.income_ledger(source,kind,source_ref,amount,description,payer_account_id,recorded_by,
    method,payment_reference,proof_path,receipt_no,notes)
   VALUES('event_rental','sale',b.booking_id::text,b.amount,'Event rental: '||left(e.name,120),b.payer_id,p_actor,
    p_data->>'method',ref,p_data->>'proof_path',number,p_data->>'notes') RETURNING entry_id INTO entry;
   UPDATE public.event_rental_bookings SET status='paid',version=version+1 WHERE booking_id=b.booking_id;
  ELSIF p_action='refund' THEN
   IF b.status<>'paid' OR b.version<>(p_data->>'version')::integer OR length(trim(p_data->>'note'))<8 THEN RAISE EXCEPTION 'Choose a paid booking and enter the refund reason'; END IF;
   SELECT * INTO STRICT sale FROM public.income_ledger WHERE source='event_rental' AND source_ref=b.booking_id::text AND kind='sale';
   INSERT INTO public.income_ledger(source,kind,source_ref,amount,description,payer_account_id,recorded_by,method,receipt_no,notes)
   VALUES('event_rental','refund',b.booking_id::text,-sale.amount,'Reversal of '||sale.receipt_no,
    b.payer_id,p_actor,sale.method,sale.receipt_no,p_data->>'note') RETURNING entry_id INTO entry;
   UPDATE public.event_rental_bookings SET status='refunded',version=version+1 WHERE booking_id=b.booking_id;
  ELSE
   IF b.status NOT IN ('awaiting_payment','complimentary') OR length(trim(p_data->>'note'))<8
   THEN RAISE EXCEPTION 'Cancel an unpaid booking with a reason. Refund paid bookings'; END IF;
   UPDATE public.event_rental_bookings SET status='cancelled',version=version+1 WHERE booking_id=b.booking_id;
  END IF;
 ELSE RAISE EXCEPTION 'Unknown rental command';
 END IF;
 result=jsonb_build_object('id',identifier,'entry_id',entry,'action',p_action);
 INSERT INTO public.event_rental_history(request_id,actor_id,action,fingerprint,result)
 VALUES(p_request,p_actor,p_action,p_data,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.event_rental_command(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_rental_command(uuid,uuid,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.event_rental_schedule_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF (NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
  OR NEW.organizer_name IS DISTINCT FROM OLD.organizer_name OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
 AND EXISTS(SELECT FROM public.event_rental_bookings WHERE event_id=OLD.event_id AND status IN ('awaiting_payment','paid','complimentary'))
 THEN RAISE EXCEPTION 'Cancel or refund the current rental before changing the agreed schedule, organizer or deletion state'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_event_rental_schedule ON public.event_workspaces;
CREATE TRIGGER trg_event_rental_schedule BEFORE UPDATE ON public.event_workspaces
FOR EACH ROW EXECUTE FUNCTION public.event_rental_schedule_guard();
CREATE OR REPLACE FUNCTION public.event_rental_tag_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE b public.event_rental_bookings%ROWTYPE; total integer;
BEGIN
 IF NEW.ended_at IS NOT NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.event_workspaces WHERE event_id=NEW.event_id FOR UPDATE;
 SELECT * INTO b FROM public.event_rental_bookings WHERE event_id=NEW.event_id
 AND status IN ('awaiting_payment','paid','complimentary');
 IF FOUND THEN
  IF b.status='awaiting_payment' THEN RAISE EXCEPTION 'Confirm rental payment before assigning new event tags'; END IF;
  SELECT count(*) INTO total FROM public.event_tag_allocations WHERE event_id=NEW.event_id AND ended_at IS NULL;
  IF total >= (b.quote->>'included_tags')::integer THEN RAISE EXCEPTION 'Rental package tag allocation reached'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_event_rental_tag_limit ON public.event_tag_allocations;
CREATE TRIGGER trg_event_rental_tag_limit BEFORE INSERT ON public.event_tag_allocations
FOR EACH ROW EXECUTE FUNCTION public.event_rental_tag_limit();
CREATE OR REPLACE FUNCTION public.event_rental_history_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Rental history is append only'; END $$;
DROP TRIGGER IF EXISTS trg_event_rental_history ON public.event_rental_history;
CREATE TRIGGER trg_event_rental_history BEFORE UPDATE OR DELETE ON public.event_rental_history
FOR EACH ROW EXECUTE FUNCTION public.event_rental_history_guard();
-- Existing event deletion remains recoverable. Bookings and ledger retain foreign keys and history.
INSERT INTO public.migration_log(name,note) VALUES('20261124b_event_rentals','University full-payment rental pilot')
ON CONFLICT(name) DO NOTHING;
COMMIT;
