-- Superadmin-only permanent user deletion with a fresh Google Authenticator step.
-- Apply after the existing account, claim-history, and Admin MFA migrations.
-- The Flask backend verifies and consumes the six-digit TOTP, then invokes this
-- service-role-only RPC with the accepted step.
-- Safe to rerun.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_delete_user(
    p_target_account_id UUID,
    p_admin_id UUID,
    p_totp_step BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    actor_level TEXT;
    target_row public.user_profiles%ROWTYPE;
    mfa_enabled_at TIMESTAMPTZ;
    mfa_last_step BIGINT;
    mfa_locked_until TIMESTAMPTZ;
    active_super_admin_count INTEGER;
    owned_found_item_ids UUID[] := ARRAY[]::UUID[];
    owned_missing_item_ids UUID[] := ARRAY[]::UUID[];
    affected_claim_ids UUID[] := ARRAY[]::UUID[];
    deleted_claim_count INTEGER := 0;
    deleted_activity_count INTEGER := 0;
    deleted_notification_count INTEGER := 0;
    v_table_name TEXT;
    v_column_name TEXT;
    v_rows_deleted INTEGER;
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    SELECT coalesce(nullif(lower(access_level), ''), nullif(lower(user_role), ''))
    INTO actor_level
    FROM public.user_profiles
    WHERE account_id = p_admin_id
      AND is_active IS DISTINCT FROM false;

    IF coalesce(actor_level, '') <> 'super_admin' THEN
        RAISE EXCEPTION 'Super administrator access required';
    END IF;

    -- Serialize all superadmin deletions and keep the last-admin count stable.
    PERFORM account_id
    FROM public.user_profiles
    WHERE is_active IS DISTINCT FROM false
      AND (lower(coalesce(access_level, '')) = 'super_admin'
           OR lower(coalesce(user_role, '')) = 'super_admin')
    ORDER BY account_id
    FOR UPDATE;

        SELECT coalesce(nullif(lower(access_level), ''), nullif(lower(user_role), ''))
        INTO actor_level
        FROM public.user_profiles
        WHERE account_id = p_admin_id
            AND is_active IS DISTINCT FROM false;

        IF coalesce(actor_level, '') <> 'super_admin' THEN
                RAISE EXCEPTION 'Super administrator access required';
        END IF;

    IF p_target_account_id IS NULL OR p_target_account_id = p_admin_id THEN
        RAISE EXCEPTION 'You cannot delete your own account';
    END IF;

    SELECT * INTO target_row
    FROM public.user_profiles
    WHERE account_id = p_target_account_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF coalesce(nullif(lower(target_row.access_level), ''), nullif(lower(target_row.user_role), '')) = 'super_admin' THEN
        SELECT count(*) INTO active_super_admin_count
        FROM public.user_profiles
        WHERE is_active IS DISTINCT FROM false
          AND (lower(coalesce(access_level, '')) = 'super_admin'
               OR lower(coalesce(user_role, '')) = 'super_admin');

        IF active_super_admin_count <= 1 THEN
            RAISE EXCEPTION 'Cannot delete the last active superadministrator';
        END IF;
    END IF;

    SELECT enabled_at, last_accepted_step, locked_until
    INTO mfa_enabled_at, mfa_last_step, mfa_locked_until
    FROM public.admin_mfa
    WHERE account_id = p_admin_id
    FOR UPDATE;

    IF NOT FOUND OR mfa_enabled_at IS NULL THEN
        RAISE EXCEPTION 'Google Authenticator must be enabled for user deletion';
    END IF;
    IF mfa_locked_until IS NOT NULL AND mfa_locked_until > now() THEN
        RAISE EXCEPTION 'Google Authenticator is temporarily locked';
    END IF;
    IF p_totp_step IS NULL OR mfa_last_step IS DISTINCT FROM p_totp_step THEN
        RAISE EXCEPTION 'A fresh Google Authenticator code is required';
    END IF;

    SELECT coalesce(array_agg(item_id), ARRAY[]::UUID[])
    INTO owned_found_item_ids
    FROM public.found_items
    WHERE account_id = p_target_account_id;

    SELECT coalesce(array_agg(item_id), ARRAY[]::UUID[])
    INTO owned_missing_item_ids
    FROM public.missing_items
    WHERE account_id = p_target_account_id;

    SELECT coalesce(array_agg(claim_id), ARRAY[]::UUID[])
    INTO affected_claim_ids
    FROM public.claims
    WHERE claimant_account_id = p_target_account_id
       OR found_item_id = ANY(owned_found_item_ids);

     DELETE FROM public.user_notifications
     WHERE user_account_id = p_target_account_id
         OR found_item_id = ANY(owned_found_item_ids)
         OR missing_report_id = ANY(owned_missing_item_ids);
     GET DIAGNOSTICS deleted_notification_count = ROW_COUNT;

    PERFORM set_config('app.claim_actor_account_id', p_admin_id::TEXT, true);

    DELETE FROM public.claims
    WHERE claimant_account_id = p_target_account_id
       OR found_item_id = ANY(owned_found_item_ids);
    GET DIAGNOSTICS deleted_claim_count = ROW_COUNT;

    -- Reports owned by another account survive; remove the deleted reporter's
    -- profile details from those rows before their FK is set to NULL.
    UPDATE public.found_items
    SET reporter_account_id = NULL,
        reporter_email = 'deleted-account@invalid',
        reporter_campus_id = NULL,
        reporter_name = 'Deleted account'
    WHERE reporter_account_id = p_target_account_id
      AND account_id <> p_target_account_id;

    UPDATE public.missing_items
    SET reporter_account_id = NULL,
        reporter_email = 'deleted-account@invalid',
        reporter_campus_id = NULL,
        reporter_name = 'Deleted account'
    WHERE reporter_account_id = p_target_account_id
      AND account_id <> p_target_account_id;

    -- Remove audit entries authored by this account, including legacy log tables
    -- that may exist without a foreign key to user_profiles.
    FOREACH v_table_name IN ARRAY ARRAY['user_activity_logs', 'activity_logs', 'admin_activity_logs'] LOOP
        IF to_regclass(format('public.%I', v_table_name)) IS NULL THEN
            CONTINUE;
        END IF;

        FOREACH v_column_name IN ARRAY ARRAY[
            'account_id', 'user_account_id', 'user_id', 'admin_account_id',
            'admin_id', 'actor_account_id'
        ] LOOP
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns AS c
                WHERE c.table_schema = 'public'
                  AND c.table_name = v_table_name
                  AND c.column_name = v_column_name
            ) THEN
                EXECUTE format(
                    'DELETE FROM public.%I WHERE %I::TEXT = $1',
                    v_table_name,
                    v_column_name
                ) USING p_target_account_id::TEXT;
                GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
                deleted_activity_count := deleted_activity_count + v_rows_deleted;
            END IF;
        END LOOP;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns AS c
            WHERE c.table_schema = 'public'
              AND c.table_name = v_table_name
              AND c.column_name = 'target_id'
        ) THEN
            EXECUTE format(
                'DELETE FROM public.%I WHERE target_id::TEXT = $1',
                v_table_name
            ) USING p_target_account_id::TEXT;
            GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
            deleted_activity_count := deleted_activity_count + v_rows_deleted;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns AS c
            WHERE c.table_schema = 'public'
              AND c.table_name = v_table_name
              AND c.column_name = 'target_name'
        ) THEN
            EXECUTE format(
                'DELETE FROM public.%I WHERE lower(target_name::TEXT) = lower($1)',
                v_table_name
            ) USING target_row.email;
            GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
            deleted_activity_count := deleted_activity_count + v_rows_deleted;
        END IF;
    END LOOP;

    DELETE FROM public.otp_tokens
    WHERE lower(email) = lower(target_row.email);

    -- Claim-history snapshots have no FK to claims, so remove affected snapshots
    -- explicitly, including snapshots generated by the cascade above.
    DELETE FROM public.claim_change_history
    WHERE claim_id = ANY(affected_claim_ids)
       OR actor_account_id = p_target_account_id
       OR old_values ->> 'claimant_account_id' = p_target_account_id::TEXT
       OR new_values ->> 'claimant_account_id' = p_target_account_id::TEXT
       OR old_values ->> 'reviewed_by' = p_target_account_id::TEXT
       OR new_values ->> 'reviewed_by' = p_target_account_id::TEXT
       OR old_values ->> 'released_by' = p_target_account_id::TEXT
       OR new_values ->> 'released_by' = p_target_account_id::TEXT;

    DELETE FROM public.user_profiles
    WHERE account_id = p_target_account_id;

    RETURN jsonb_build_object(
        'account_id', p_target_account_id,
        'email', target_row.email,
        'name', trim(concat_ws(' ', target_row.fname, target_row.mname, target_row.lname)),
        'access_level', target_row.access_level,
        'deleted_found_items', cardinality(owned_found_item_ids),
        'deleted_missing_items', cardinality(owned_missing_item_ids),
        'deleted_claims', deleted_claim_count,
        'deleted_notifications', deleted_notification_count,
        'deleted_activity_rows', deleted_activity_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(UUID, UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID, UUID, BIGINT) TO service_role;

COMMIT;
