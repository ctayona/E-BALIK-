-- Migration: Create ai_matches table for persisting AI match confirmation/rejection status
-- Run this SQL in Supabase SQL Editor if the ai_matches table doesn't exist

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

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_ai_matches_missing_item_id ON ai_matches(missing_item_id);
CREATE INDEX IF NOT EXISTS idx_ai_matches_found_item_id ON ai_matches(found_item_id);
CREATE INDEX IF NOT EXISTS idx_ai_matches_status ON ai_matches(status);
CREATE INDEX IF NOT EXISTS idx_ai_matches_created_at ON ai_matches(created_at DESC);

-- Verify the table was created
SELECT 'ai_matches table created successfully' AS message;
