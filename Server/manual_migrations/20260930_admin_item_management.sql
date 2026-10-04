-- Persist display names entered by admins for manually registered item reports.
-- Run in the Supabase SQL Editor before deploying the admin CRUD backend.
-- Safe to rerun.

BEGIN;

ALTER TABLE public.found_items
    ADD COLUMN IF NOT EXISTS reporter_name VARCHAR(255);

ALTER TABLE public.missing_items
    ADD COLUMN IF NOT EXISTS reporter_name VARCHAR(255);

CREATE OR REPLACE FUNCTION public.admin_delete_missing_item(
    p_item_reference TEXT,
    p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    actor_level TEXT;
    item_row public.missing_items%ROWTYPE;  
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    SELECT access_level INTO actor_level
    FROM public.user_profiles
    WHERE account_id = p_admin_id;

    IF coalesce(actor_level, '') <> 'super_admin' THEN
        RAISE EXCEPTION 'Super administrator access required';
    END IF;

    SELECT * INTO item_row
    FROM public.missing_items
    WHERE mpost_id = p_item_reference OR item_id::TEXT = p_item_reference
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    DELETE FROM public.missing_items WHERE item_id = item_row.item_id;
    RETURN to_jsonb(item_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_found_item(
    p_item_reference TEXT,
    p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    actor_level TEXT;
    item_row public.found_items%ROWTYPE;
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    SELECT access_level INTO actor_level
    FROM public.user_profiles
    WHERE account_id = p_admin_id;

    IF coalesce(actor_level, '') <> 'super_admin' THEN
        RAISE EXCEPTION 'Super administrator access required';
    END IF;

    SELECT * INTO item_row
    FROM public.found_items
    WHERE fpost_id = p_item_reference OR item_id::TEXT = p_item_reference
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    PERFORM set_config('app.claim_actor_account_id', p_admin_id::TEXT, true);
    DELETE FROM public.found_items WHERE item_id = item_row.item_id;
    RETURN to_jsonb(item_row);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_missing_item(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_delete_found_item(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_missing_item(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_found_item(TEXT, UUID) TO service_role;

COMMIT;
