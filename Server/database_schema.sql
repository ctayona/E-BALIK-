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
-- Verification roles, timed suspension and system control
-- manual_migrations/20261007_report_integrity_and_reactions.sql adds auction_reactions and the one-open-claim index (run that file on an existing database)
-- Mirrors manual_migrations/20261006_system_control_verification.sql (run that file on an existing database).
-- ============================================================================
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS user_category VARCHAR(20),          -- 'Student' | 'Faculty' | 'Staff' | 'Visitor', assigned by an admin when verifying
    ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMP WITH TIME ZONE,  -- NULL with is_active = false means an indefinite suspension
    ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
    ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES user_profiles(account_id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_user_category_check') THEN
        ALTER TABLE user_profiles
            ADD CONSTRAINT user_profiles_user_category_check
            CHECK (user_category IS NULL OR user_category IN ('Student', 'Faculty', 'Staff', 'Visitor'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_profiles_suspended_until ON user_profiles(suspended_until) WHERE suspended_until IS NOT NULL;

-- System settings (key/value). Keys: maintenance_mode {enabled, message, since}, sessions_valid_after {ts}, last_cleanup {...}
CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(64) PRIMARY KEY,
    setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by UUID REFERENCES user_profiles(account_id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Auction Hall (auctions, auction_bids, auction_comments, auction_place_bid, auction_settle_due)
-- Defined in manual_migrations/20261005_auction_hall.sql. Run that file in the SQL Editor; it is not repeated here.
-- ============================================================================

-- ============================================================================
-- USEFUL QUERIES FOR FUTURE REFERENCE
-- ============================================================================
-- Check user count: SELECT COUNT(*) FROM user_profiles;
-- Find user by email: SELECT * FROM user_profiles WHERE email = 'user@umak.edu.ph';
-- Find active users: SELECT * FROM user_profiles WHERE is_active = true;
-- Count registrations by date: SELECT DATE(created_at), COUNT(*) FROM user_profiles GROUP BY DATE(created_at);


-- ============================================================================
-- TABLE: smart_tags (QR stickers)
-- Mirrors manual_migrations/20261008_smart_tags.sql (run that file on an existing database).
-- tag_id is generated by the backend with a cryptographically secure RNG (12 chars, no look-alike letters).
-- Backend-only access: RLS on, no policies.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.smart_tags (
    tag_id VARCHAR(12) PRIMARY KEY CHECK (tag_id ~ '^[A-Z0-9]{10,12}$'),
    owner_account_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    item_name VARCHAR(120),
    item_description TEXT,
    item_image_url TEXT,  -- storage path (private bucket smart-tag-images) of the approved live photo of the item with its sticker
    pending_image_url TEXT,  -- a new photo waiting for staff approval (item_image_url keeps the approved one)
    status VARCHAR(24) NOT NULL DEFAULT 'blank' CHECK (status IN ('blank', 'pending_verification', 'active', 'lost', 'expired')),
    prior_status VARCHAR(10) CHECK (prior_status IS NULL OR prior_status IN ('active', 'lost')),  -- where the tag returns after a new photo is reviewed
    review_requested_at TIMESTAMPTZ,  -- when the owner submitted the registration or the new photo
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    verification_note TEXT,  -- the reason when staff rejected the last submission

    -- What a finder is allowed to see. Everything is hidden unless the owner switches it on.
    show_name BOOLEAN NOT NULL DEFAULT FALSE,
    show_email BOOLEAN NOT NULL DEFAULT FALSE,
    show_phone BOOLEAN NOT NULL DEFAULT FALSE,
    contact_phone VARCHAR(30),

    -- Admin control: a disabled tag shows nothing to finders and cannot be edited by its owner.
    is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
    disabled_reason VARCHAR(300),
    disabled_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    disabled_at TIMESTAMPTZ,

    batch_label VARCHAR(80),
    created_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    last_found_notice_at TIMESTAMPTZ,
    found_notice_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Added by 20261009: medium, validity, batch and visit statistics.
    tag_type VARCHAR(10) NOT NULL DEFAULT 'qr' CHECK (tag_type IN ('qr', 'rfid', 'nfc')),
    validity_months INTEGER CHECK (validity_months IS NULL OR validity_months BETWEEN 1 AND 120),
    valid_until TIMESTAMPTZ,
    batch_id UUID,
    scan_count INTEGER NOT NULL DEFAULT 0,
    last_scanned_at TIMESTAMPTZ,

    -- A blank tag has no owner details yet; a claimed tag has an item name.
    CONSTRAINT smart_tags_blank_has_no_details CHECK (status <> 'blank' OR (item_name IS NULL AND NOT show_name AND NOT show_email AND NOT show_phone))
);

CREATE INDEX IF NOT EXISTS idx_smart_tags_owner ON public.smart_tags(owner_account_id);
CREATE INDEX IF NOT EXISTS idx_smart_tags_status ON public.smart_tags(status);
CREATE INDEX IF NOT EXISTS idx_smart_tags_created_at ON public.smart_tags(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_smart_tags_batch ON public.smart_tags(batch_label);

-- Only the backend (service key) reads or writes this table. The public page goes through the API, which returns
-- an explicit allow-list of fields, so no policy is created and anonymous database access stays closed.
ALTER TABLE public.smart_tags ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_smart_tags_batch_id ON public.smart_tags(batch_id);
CREATE INDEX IF NOT EXISTS idx_smart_tags_valid_until ON public.smart_tags(valid_until) WHERE status IN ('active', 'lost');
CREATE INDEX IF NOT EXISTS idx_smart_tags_pending ON public.smart_tags(review_requested_at) WHERE status = 'pending_verification';

-- ============================================================================
-- Existing databases: manual_migrations/20261009_tag_expiry_and_auction_buyout.sql adds the smart_tags columns above,
-- allows the 'expired' status, and adds to auctions:
--   buyout_price NUMERIC(12,2)   -- optional "Buy Now" price, must be greater than starting_price
--   bought_out   BOOLEAN         -- true when the auction ended through Buy Now
-- It also replaces auction_place_bid() so a bid at or above buyout_price ends the auction atomically.
-- ============================================================================

-- ============================================================================
-- Smart Tag photo and Mission Control storage tools
-- Existing databases: manual_migrations/20261010_tag_photo_and_mission_control.sql adds smart_tags.item_image_url,
-- creates the PRIVATE bucket smart-tag-images (5 MB, jpeg/png/webp) and two service-role-only read functions used by the
-- Storage card in System Control:
--   storage_bucket_stats()                                  -- objects and bytes per bucket
--   storage_list_objects(p_bucket, p_limit, p_offset)       -- names, sizes and ages, for the orphaned-image scan
-- The announcement banner is stored in system_settings under the key 'announcement' (no new table).
--
-- Staff verification: manual_migrations/20261011_tag_staff_verification.sql widens smart_tags.status to VARCHAR(24), adds the
-- status 'pending_verification' (a new registration, or an active tag whose owner took a new photo, waits here until an admin
-- compares the screen with the real item) and the review columns shown above. Existing active tags stay active.
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('smart-tag-images', 'smart-tag-images', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Handover PINs, automatic auction pickup deadlines and the bidding ban
-- Mirrors manual_migrations/20261012_handover_pins_and_auction_timeouts.sql (run that file on an existing database).
-- claims: the 6 character Handover PIN created when an admin approves a claim. Only an HMAC (lookup) and an encrypted copy
-- (shown to the claimant) are stored. The guard types the PIN to release the item; the claim then becomes 'collected'.
-- auctions (defined by the Auction Hall migrations): pickup_warning_sent_at = 24-hour final warning sent after 48 hours;
-- auto_forfeited_at = win forfeited automatically after 72 hours (ready for Re-Auction).
-- user_profiles: bidding_banned_until = no bidding until this time (30 days after a forfeited win).
-- ============================================================================
ALTER TABLE claims
    ADD COLUMN IF NOT EXISTS handover_pin_hash TEXT,
    ADD COLUMN IF NOT EXISTS handover_pin_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS handover_pin_issued_at TIMESTAMP WITH TIME ZONE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_claims_handover_pin_hash ON claims (handover_pin_hash) WHERE handover_pin_hash IS NOT NULL;

DO $$
BEGIN
    IF to_regclass('public.auctions') IS NOT NULL THEN
        ALTER TABLE public.auctions
            ADD COLUMN IF NOT EXISTS pickup_warning_sent_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS auto_forfeited_at TIMESTAMP WITH TIME ZONE;
        CREATE INDEX IF NOT EXISTS idx_auctions_pickup_deadlines ON public.auctions (winner_notified_at)
            WHERE status = 'ended' AND fulfillment_status = 'awaiting_pickup';
    END IF;
END $$;

ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS bidding_banned_until TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS bidding_ban_reason TEXT;

-- ============================================================================
-- Guard role, email preferences, claim pickup reminders, Smart Tag expiry reminders and evidence retention
-- Mirrors manual_migrations/20261013_guard_role_reminders_and_retention.sql (run that file on an existing database).
-- access_level 'guard' = release desk: can only use the Handover PIN screen. admin_set_user_access_level() accepts it (see the migration).
-- email_preferences: {"reminders": bool, "announcements": bool}; a missing key means on.
-- claims.pickup_deadline (older column) is set when a claim is approved; pickup_reminder_sent_at = reminder sent; evidence_purged_at =
-- the ID document and proof photo were deleted after the retention period (EVIDENCE_RETENTION_DAYS, default 30).
-- ============================================================================
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_access_level_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_access_level_check CHECK (access_level IN ('user', 'guard', 'admin', 'super_admin'));
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE claims
    ADD COLUMN IF NOT EXISTS pickup_reminder_sent_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS evidence_purged_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_claims_open_pickups ON claims (pickup_deadline) WHERE status = 'approved_for_pickup';
CREATE INDEX IF NOT EXISTS idx_claims_evidence_pending ON claims (updated_at) WHERE status IN ('collected', 'rejected') AND evidence_purged_at IS NULL;

DO $$
BEGIN
    IF to_regclass('public.smart_tags') IS NOT NULL THEN
        ALTER TABLE public.smart_tags ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at TIMESTAMP WITH TIME ZONE;
        CREATE INDEX IF NOT EXISTS idx_smart_tags_expiry_reminder ON public.smart_tags (valid_until)
            WHERE status IN ('active', 'lost') AND expiry_reminder_sent_at IS NULL;
    END IF;
END $$;

-- ============================================================================
-- Recycle bin
-- Mirrors manual_migrations/20261014_recycle_bin.sql (run that file on an existing database).
-- One row per deleted record: a JSON snapshot of it and what was deleted with it, plus the files copied into the private `recycle-bin`
-- bucket. Restoring puts them back; purging (by hand with an authenticator code, or automatically at expires_at) empties it.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recycle_bin (
    archive_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('claim', 'found_item', 'missing_item', 'user', 'auction', 'evidence')),
    entity_id TEXT NOT NULL,
    label TEXT NOT NULL,
    reason VARCHAR(20) NOT NULL DEFAULT 'admin_delete' CHECK (reason IN ('admin_delete', 'retention')),
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    files JSONB NOT NULL DEFAULT '[]'::jsonb,
    deleted_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL,
    deleted_by_label TEXT,
    deleted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'archived' CHECK (status IN ('archived', 'restored', 'purged')),
    finished_at TIMESTAMP WITH TIME ZONE,
    finished_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_recycle_bin_archived ON public.recycle_bin (deleted_at DESC) WHERE status = 'archived';
CREATE INDEX IF NOT EXISTS idx_recycle_bin_expiry ON public.recycle_bin (expires_at) WHERE status = 'archived';
CREATE INDEX IF NOT EXISTS idx_recycle_bin_entity ON public.recycle_bin (entity_type, entity_id);
ALTER TABLE public.recycle_bin ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('recycle-bin', 'recycle-bin', false, 26214400)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Report lifecycle and guard handover
-- Mirrors manual_migrations/20261015_report_lifecycle_and_guard_handover.sql (run that file on an existing database; it also replaces the
-- functions admin_update_claim_status, close_reports_after_claim_collection and admin_set_user_access_level).
-- claims.missing_report_id: the claimant's own lost report that the claim is for. It is completed (status 'returned', shown as "Completed")
-- when the claim is collected, together with any report an administrator confirmed as a match.
-- found_items.handover_guard_id: the guard the finder handed the item to (guard_name_or_id keeps the readable name).
-- ============================================================================
ALTER TABLE public.claims
    ADD COLUMN IF NOT EXISTS missing_report_id UUID REFERENCES public.missing_items(item_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_claims_missing_report ON public.claims (missing_report_id) WHERE missing_report_id IS NOT NULL;
ALTER TABLE public.found_items
    ADD COLUMN IF NOT EXISTS handover_guard_id UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_found_items_handover_guard ON public.found_items (handover_guard_id) WHERE handover_guard_id IS NOT NULL;

-- ============================================================================
-- Archive and exact bid steps
-- Mirrors manual_migrations/20261016_archive_and_bid_steps.sql (run that file on an existing database; it also replaces auction_place_bid).
-- archived_at / archived_by hide a FINISHED lost report, found report, claim or auction from the admin working lists (its page's Archived tab)
-- without deleting anything. auction_place_bid refuses a bid between two steps of the ladder (starting bid + whole increments).
-- ============================================================================
ALTER TABLE public.missing_items ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;
ALTER TABLE public.found_items   ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;
ALTER TABLE public.claims        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;
ALTER TABLE public.auctions      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_missing_items_archived ON public.missing_items (archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_found_items_archived   ON public.found_items   (archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_claims_archived        ON public.claims        (archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auctions_archived      ON public.auctions      (archived_at) WHERE archived_at IS NOT NULL;
