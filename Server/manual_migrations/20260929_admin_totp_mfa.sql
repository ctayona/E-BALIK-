-- Admin authenticator-app TOTP MFA storage and single-use verification helpers.
-- Run after 20260928_claim_identity_and_admin_access.sql and before deploying
-- the MFA-enabled backend/frontend code.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_mfa (
    account_id UUID PRIMARY KEY REFERENCES public.user_profiles(account_id) ON DELETE CASCADE,
    secret_ciphertext TEXT,
    pending_secret_ciphertext TEXT,
    pending_expires_at TIMESTAMPTZ,
    enabled_at TIMESTAMPTZ,
    last_accepted_step BIGINT,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    session_generation INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_mfa
    ADD COLUMN IF NOT EXISTS session_generation INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.admin_mfa_challenges (
    challenge_id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES public.user_profiles(account_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_mfa_challenges_expiry
    ON public.admin_mfa_challenges(expires_at);

CREATE TABLE IF NOT EXISTS public.admin_mfa_recovery_codes (
    account_id UUID NOT NULL REFERENCES public.user_profiles(account_id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, code_hash)
);

ALTER TABLE public.admin_mfa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.admin_enable_mfa(
    p_account_id UUID,
    p_secret_ciphertext TEXT,
    p_totp_step BIGINT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    current_access_level TEXT;
    next_generation INTEGER;
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    SELECT access_level INTO current_access_level
    FROM public.user_profiles
    WHERE account_id = p_account_id AND is_active IS DISTINCT FROM false;

    IF coalesce(current_access_level, '') NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'Active administrator access required';
    END IF;

    UPDATE public.admin_mfa
    SET secret_ciphertext = p_secret_ciphertext,
        pending_secret_ciphertext = NULL,
        pending_expires_at = NULL,
        enabled_at = now(),
        last_accepted_step = p_totp_step,
        failed_attempts = 0,
        locked_until = NULL,
        session_generation = session_generation + 1,
        updated_at = now()
    WHERE account_id = p_account_id
    RETURNING session_generation INTO next_generation;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Admin MFA enrollment record was not found';
    END IF;

    RETURN next_generation;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_disable_mfa(p_account_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    current_access_level TEXT;
    next_generation INTEGER;
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    SELECT access_level INTO current_access_level
    FROM public.user_profiles
    WHERE account_id = p_account_id AND is_active IS DISTINCT FROM false;

    IF coalesce(current_access_level, '') NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'Active administrator access required';
    END IF;

    UPDATE public.admin_mfa
    SET secret_ciphertext = NULL,
        pending_secret_ciphertext = NULL,
        pending_expires_at = NULL,
        enabled_at = NULL,
        last_accepted_step = NULL,
        failed_attempts = 0,
        locked_until = NULL,
        session_generation = session_generation + 1,
        updated_at = now()
    WHERE account_id = p_account_id
    RETURNING session_generation INTO next_generation;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Admin MFA enrollment record was not found';
    END IF;

    DELETE FROM public.admin_mfa_recovery_codes WHERE account_id = p_account_id;
    RETURN next_generation;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_admin_mfa_challenge(
    p_challenge_id UUID,
    p_account_id UUID,
    p_totp_step BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    challenge_row public.admin_mfa_challenges%ROWTYPE;
    mfa_row public.admin_mfa%ROWTYPE;
    current_access_level TEXT;
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    SELECT access_level INTO current_access_level
    FROM public.user_profiles
    WHERE account_id = p_account_id AND is_active IS DISTINCT FROM false;

    IF coalesce(current_access_level, '') NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'Active administrator access required';
    END IF;

    SELECT * INTO challenge_row
    FROM public.admin_mfa_challenges
    WHERE challenge_id = p_challenge_id
      AND account_id = p_account_id
      AND used_at IS NULL
      AND expires_at > now()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    SELECT * INTO mfa_row
    FROM public.admin_mfa
    WHERE account_id = p_account_id
      AND enabled_at IS NOT NULL
    FOR UPDATE;

    IF NOT FOUND OR (mfa_row.locked_until IS NOT NULL AND mfa_row.locked_until > now()) THEN
        RETURN false;
    END IF;

     IF p_totp_step IS NOT NULL
         AND mfa_row.last_accepted_step IS NOT NULL
         AND p_totp_step <= mfa_row.last_accepted_step THEN
        RETURN false;
    END IF;

    UPDATE public.admin_mfa
    SET last_accepted_step = coalesce(p_totp_step, last_accepted_step),
        failed_attempts = 0,
        locked_until = NULL,
        updated_at = now()
    WHERE account_id = p_account_id;

    UPDATE public.admin_mfa_challenges
    SET used_at = now()
    WHERE challenge_id = p_challenge_id;

    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_admin_mfa_failure(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    UPDATE public.admin_mfa
    SET failed_attempts = failed_attempts + 1,
        locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '10 minutes' ELSE locked_until END,
        updated_at = now()
        WHERE account_id = p_account_id
            AND (enabled_at IS NOT NULL OR pending_secret_ciphertext IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_admin_mfa_step(
    p_account_id UUID,
    p_totp_step BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    mfa_row public.admin_mfa%ROWTYPE;
    current_access_level TEXT;
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    SELECT access_level INTO current_access_level
    FROM public.user_profiles
    WHERE account_id = p_account_id AND is_active IS DISTINCT FROM false;

    IF coalesce(current_access_level, '') NOT IN ('admin', 'super_admin') THEN
        RETURN false;
    END IF;

    SELECT * INTO mfa_row
    FROM public.admin_mfa
    WHERE account_id = p_account_id
      AND enabled_at IS NOT NULL
    FOR UPDATE;

    IF NOT FOUND OR (mfa_row.locked_until IS NOT NULL AND mfa_row.locked_until > now()) THEN
        RETURN false;
    END IF;

    IF mfa_row.last_accepted_step IS NOT NULL AND p_totp_step <= mfa_row.last_accepted_step THEN
        RETURN false;
    END IF;

    UPDATE public.admin_mfa
    SET last_accepted_step = p_totp_step,
        failed_attempts = 0,
        locked_until = NULL,
        updated_at = now()
    WHERE account_id = p_account_id;

    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_admin_mfa_recovery_code(
    p_account_id UUID,
    p_code_hash TEXT,
    p_challenge_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    current_access_level TEXT;
    consumed_code UUID;
    challenge_row public.admin_mfa_challenges%ROWTYPE;
    mfa_row public.admin_mfa%ROWTYPE;
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    SELECT access_level INTO current_access_level
    FROM public.user_profiles
    WHERE account_id = p_account_id AND is_active IS DISTINCT FROM false;

    IF coalesce(current_access_level, '') NOT IN ('admin', 'super_admin') THEN
        RETURN false;
    END IF;

        SELECT * INTO challenge_row
        FROM public.admin_mfa_challenges
        WHERE challenge_id = p_challenge_id
            AND account_id = p_account_id
            AND used_at IS NULL
            AND expires_at > now()
        FOR UPDATE;

        IF NOT FOUND THEN
                RETURN false;
        END IF;

        SELECT * INTO mfa_row
        FROM public.admin_mfa
        WHERE account_id = p_account_id
            AND enabled_at IS NOT NULL
        FOR UPDATE;

        IF NOT FOUND OR (mfa_row.locked_until IS NOT NULL AND mfa_row.locked_until > now()) THEN
                RETURN false;
        END IF;

    UPDATE public.admin_mfa_recovery_codes
    SET used_at = now()
    WHERE account_id = p_account_id
      AND code_hash = p_code_hash
      AND used_at IS NULL
    RETURNING account_id INTO consumed_code;

    IF consumed_code IS NULL THEN
        RETURN false;
    END IF;

    UPDATE public.admin_mfa_challenges
    SET used_at = now()
    WHERE challenge_id = p_challenge_id;

    UPDATE public.admin_mfa
    SET failed_attempts = 0,
        locked_until = NULL,
        updated_at = now()
    WHERE account_id = p_account_id AND enabled_at IS NOT NULL;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_admin_mfa_challenge(UUID, UUID, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_enable_mfa(UUID, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_disable_mfa(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_admin_mfa_failure(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_admin_mfa_step(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_admin_mfa_recovery_code(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_admin_mfa_challenge(UUID, UUID, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_enable_mfa(UUID, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_disable_mfa(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_admin_mfa_failure(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_admin_mfa_step(UUID, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_admin_mfa_recovery_code(UUID, TEXT, UUID) TO service_role;

COMMIT;
