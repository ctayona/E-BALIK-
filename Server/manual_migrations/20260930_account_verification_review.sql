-- Admin review workflow for private user account-verification documents.
-- Run in the Supabase SQL Editor before deploying the verification workflow.
-- Safe to rerun.

BEGIN;

ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS verification_document_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS verification_document_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS verification_document_url TEXT,
    ADD COLUMN IF NOT EXISTS verification_document_bucket VARCHAR(100),
    ADD COLUMN IF NOT EXISTS verification_last_updated TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN IF NOT EXISTS verification_uploaded_at TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN IF NOT EXISTS verification_review_note TEXT,
    ADD COLUMN IF NOT EXISTS verification_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verification_reviewed_by UUID REFERENCES public.user_profiles(account_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_verification_pending
    ON public.user_profiles(verification_status, verification_uploaded_at DESC)
    WHERE verification_document_name IS NOT NULL;

INSERT INTO storage.buckets (id, name, public)
VALUES ('account-verification-documents', 'account-verification-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

COMMIT;
