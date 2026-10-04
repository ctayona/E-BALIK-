-- E-BALIK LOST & FOUND SYSTEM - DATABASE SCHEMA
-- University of Makati
-- Created: 2026-08-17

-- ============================================================================
-- TABLE: user_profiles
-- Description: Stores user account information
-- Primary Identifiers: account_id, campus_id, email
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_profiles (
    account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campus_id VARCHAR(50) NOT NULL UNIQUE,
    fname VARCHAR(100) NOT NULL,
    mname VARCHAR(100),
    lname VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    user_role VARCHAR(50),
    auth_provider VARCHAR(50) DEFAULT 'local',
    google_sub VARCHAR(255),
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    last_login_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    verification_status VARCHAR(50) DEFAULT 'pending',
    verification_document_type VARCHAR(50),
    verification_document_name VARCHAR(255),
    verification_document_url TEXT,
    verification_document_bucket VARCHAR(100),
    verification_last_updated TIMESTAMP WITH TIME ZONE DEFAULT now(),
    verification_uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    verification_review_note TEXT,
    verification_reviewed_at TIMESTAMP WITH TIME ZONE,
    verification_reviewed_by UUID REFERENCES user_profiles(account_id) ON DELETE SET NULL
);

ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) DEFAULT 'local',
    ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255),
    ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS verification_document_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS verification_document_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS verification_document_url TEXT,
    ADD COLUMN IF NOT EXISTS verification_document_bucket VARCHAR(100),
    ADD COLUMN IF NOT EXISTS verification_last_updated TIMESTAMP WITH TIME ZONE DEFAULT now(),
    ADD COLUMN IF NOT EXISTS verification_uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    ADD COLUMN IF NOT EXISTS verification_review_note TEXT,
    ADD COLUMN IF NOT EXISTS verification_reviewed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS verification_reviewed_by UUID REFERENCES user_profiles(account_id) ON DELETE SET NULL;

-- Create index for faster email lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_campus_id ON user_profiles(campus_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_created_at ON user_profiles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_profiles_verification_pending
    ON user_profiles(verification_status, verification_uploaded_at DESC)
    WHERE verification_document_name IS NOT NULL;

-- ============================================================================
-- TABLE: user_activity_logs
-- Description: Stores user actions, report events, claim events, and system activity
-- Primary Identifiers: log_id, account_id, created_at
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_activity_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES user_profiles(account_id) ON DELETE SET NULL,
    user_name VARCHAR(255),
    module_name VARCHAR(100),
    action VARCHAR(255) NOT NULL,
    target_name VARCHAR(255),
    target_id VARCHAR(255),
    result VARCHAR(50) DEFAULT 'success',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_logs_account_id ON user_activity_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created_at ON user_activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_module ON user_activity_logs(module_name);

-- Backward-compatible alias for legacy environments
CREATE TABLE IF NOT EXISTS activity_logs (
    LIKE user_activity_logs INCLUDING ALL
);

-- ============================================================================
-- TABLE: otp_tokens
-- Description: Stores OTP codes for registration and password reset
-- ============================================================================
CREATE TABLE IF NOT EXISTS otp_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    otp_code TEXT NOT NULL,
    otp_type VARCHAR(50) NOT NULL, -- 'registration' or 'password_reset'
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_used BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create index for faster OTP lookups
CREATE INDEX IF NOT EXISTS idx_otp_tokens_email_type ON otp_tokens(email, otp_type);
CREATE INDEX IF NOT EXISTS idx_otp_tokens_expires_at ON otp_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_tokens_is_used ON otp_tokens(is_used);

-- ============================================================================
-- TABLE: found_items
-- Description: Stores information about found items
-- ============================================================================
CREATE TABLE IF NOT EXISTS found_items (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fpost_id VARCHAR(6) UNIQUE,
    account_id UUID NOT NULL REFERENCES user_profiles(account_id) ON DELETE CASCADE,
    reporter_account_id UUID REFERENCES user_profiles(account_id) ON DELETE SET NULL,
    reporter_email VARCHAR(255) NOT NULL,
    reporter_campus_id VARCHAR(50),
    reporter_name VARCHAR(255),
    item_name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    description TEXT,
    location VARCHAR(255),
    found_date DATE,
    image_url TEXT,
    turnover_location VARCHAR(255) NOT NULL,
    guard_name_or_id VARCHAR(150) NOT NULL,
    custody_status VARCHAR(50) DEFAULT 'turned_over',
    status VARCHAR(50) DEFAULT 'unclaimed', -- 'unclaimed', 'claimed', 'returned'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE found_items
    ADD COLUMN IF NOT EXISTS fpost_id VARCHAR(6),
    ADD COLUMN IF NOT EXISTS reporter_account_id UUID REFERENCES user_profiles(account_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reporter_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS reporter_campus_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS reporter_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS turnover_location VARCHAR(255),
    ADD COLUMN IF NOT EXISTS guard_name_or_id VARCHAR(150);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'found_items' AND column_name = 'turnover_status'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'found_items' AND column_name = 'custody_status'
    ) THEN
        ALTER TABLE found_items RENAME COLUMN turnover_status TO custody_status;
    END IF;
END $$;

ALTER TABLE found_items
    ADD COLUMN IF NOT EXISTS custody_status VARCHAR(50) DEFAULT 'turned_over';

ALTER TABLE found_items
    ALTER COLUMN status SET DEFAULT 'unclaimed';

ALTER TABLE found_items
    ALTER COLUMN image_url TYPE TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_found_items_fpost_id ON found_items(fpost_id);

CREATE INDEX IF NOT EXISTS idx_found_items_account_id ON found_items(account_id);
CREATE INDEX IF NOT EXISTS idx_found_items_status ON found_items(status);
CREATE INDEX IF NOT EXISTS idx_found_items_category ON found_items(category);

-- Run once in Supabase SQL editor before image uploads.
INSERT INTO storage.buckets (id, name, public)
VALUES ('found-item-images', 'found-item-images', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- TABLE: missing_items (Future use)
-- Description: Stores information about missing items
-- ============================================================================
CREATE TABLE IF NOT EXISTS missing_items (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mpost_id VARCHAR(6) UNIQUE,
    account_id UUID NOT NULL REFERENCES user_profiles(account_id) ON DELETE CASCADE,
    reporter_account_id UUID REFERENCES user_profiles(account_id) ON DELETE SET NULL,
    reporter_email VARCHAR(255) NOT NULL,
    reporter_campus_id VARCHAR(50),
    reporter_name VARCHAR(255),
    item_name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    description TEXT,
    distinctive_marks TEXT,
    last_location VARCHAR(255),
    last_seen_date DATE,
    image_url TEXT,
    status VARCHAR(50) DEFAULT 'missing', -- 'missing', 'found', 'returned'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE missing_items
    ADD COLUMN IF NOT EXISTS mpost_id VARCHAR(6),
    ADD COLUMN IF NOT EXISTS reporter_account_id UUID REFERENCES user_profiles(account_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reporter_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS reporter_campus_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS reporter_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS distinctive_marks TEXT;

ALTER TABLE missing_items
    ALTER COLUMN image_url TYPE TEXT,
    ALTER COLUMN status SET DEFAULT 'missing';

CREATE UNIQUE INDEX IF NOT EXISTS idx_missing_items_mpost_id ON missing_items(mpost_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('missing-item-images', 'missing-item-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_missing_items_account_id ON missing_items(account_id);
CREATE INDEX IF NOT EXISTS idx_missing_items_status ON missing_items(status);
CREATE INDEX IF NOT EXISTS idx_missing_items_category ON missing_items(category);

-- ============================================================================
-- TABLE: claims (Future use)
-- Description: Stores claims made on found items
-- ============================================================================
CREATE TABLE IF NOT EXISTS claims (
    claim_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    found_item_id UUID NOT NULL REFERENCES found_items(item_id) ON DELETE CASCADE,
    claimant_account_id UUID NOT NULL REFERENCES user_profiles(account_id) ON DELETE CASCADE,
    claim_reason TEXT,
    proof_image_url TEXT,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE claims ADD COLUMN IF NOT EXISTS proof_image_url TEXT;

-- Upgrade claims created by an older schema version.
ALTER TABLE claims
    ADD COLUMN IF NOT EXISTS claim_id UUID DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS found_item_id UUID,
    ADD COLUMN IF NOT EXISTS claimant_account_id UUID,
    ADD COLUMN IF NOT EXISTS claim_reason TEXT,
    ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claims_found_item_id_fkey') THEN
        ALTER TABLE claims
            ADD CONSTRAINT claims_found_item_id_fkey
            FOREIGN KEY (found_item_id) REFERENCES found_items(item_id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claims_claimant_account_id_fkey') THEN
        ALTER TABLE claims
            ADD CONSTRAINT claims_claimant_account_id_fkey
            FOREIGN KEY (claimant_account_id) REFERENCES user_profiles(account_id) ON DELETE CASCADE;
    END IF;
END $$;

-- ============================================================================
-- TABLE: ai_matches
-- Description: Stores AI match records and their status (confirmed/rejected)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_matches (
    match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    missing_item_id UUID NOT NULL REFERENCES missing_items(item_id) ON DELETE CASCADE,
    found_item_id UUID NOT NULL REFERENCES found_items(item_id) ON DELETE CASCADE,
    match_percent FLOAT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'confirmed', 'rejected'
    confirmed_by UUID REFERENCES user_profiles(account_id) ON DELETE SET NULL,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    rejected_by UUID REFERENCES user_profiles(account_id) ON DELETE SET NULL,
    rejected_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_matches_missing_item_id ON ai_matches(missing_item_id);
CREATE INDEX IF NOT EXISTS idx_ai_matches_found_item_id ON ai_matches(found_item_id);
CREATE INDEX IF NOT EXISTS idx_ai_matches_status ON ai_matches(status);
CREATE INDEX IF NOT EXISTS idx_ai_matches_created_at ON ai_matches(created_at DESC);

-- ============================================================================
-- TABLE: user_notifications
-- Description: Stores notifications for users (e.g., match confirmations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_account_id UUID NOT NULL REFERENCES user_profiles(account_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    notification_type VARCHAR(50) DEFAULT 'match_confirmation',
    is_read BOOLEAN DEFAULT false,
    found_item_id UUID,
    missing_report_id UUID,
    link_label VARCHAR(100) DEFAULT 'Submit a claim',
    link_page VARCHAR(50) DEFAULT 'claim',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    read_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON user_notifications(user_account_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON user_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON user_notifications(is_read);

INSERT INTO storage.buckets (id, name, public)
VALUES ('claim-proof-images', 'claim-proof-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_claims_found_item_id ON claims(found_item_id);
CREATE INDEX IF NOT EXISTS idx_claims_claimant_account_id ON claims(claimant_account_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE found_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE missing_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_profiles (users can only see their own profile, admins can see all)
CREATE POLICY "Users can view their own profile"
    ON user_profiles FOR SELECT
    USING (auth.uid()::text = account_id::text OR auth.jwt() ->> 'user_role' = 'admin');

CREATE POLICY "Users can update their own profile"
    ON user_profiles FOR UPDATE
    USING (auth.uid()::text = account_id::text);

-- RLS Policies for otp_tokens (only backend service can access)
CREATE POLICY "Service role can access OTP tokens"
    ON otp_tokens FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- RLS Policies for claims (admins and backend service can approve/reject claims)
CREATE POLICY "Admins can view claims"
    ON claims FOR SELECT
    USING (auth.jwt() ->> 'user_role' = 'admin' OR auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Admins can update claims"
    ON claims FOR UPDATE
    USING (auth.jwt() ->> 'user_role' = 'admin' OR auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'user_role' = 'admin' OR auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage claims"
    ON claims FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- USEFUL QUERIES FOR FUTURE REFERENCE
-- ============================================================================
-- Check user count: SELECT COUNT(*) FROM user_profiles;
-- Find user by email: SELECT * FROM user_profiles WHERE email = 'user@umak.edu.ph';
-- Find active users: SELECT * FROM user_profiles WHERE is_active = true;
-- Count registrations by date: SELECT DATE(created_at), COUNT(*) FROM user_profiles GROUP BY DATE(created_at);
