-- Migration: Create scale_records table for Lefu WiFi Torre Scale data
-- Run this SQL in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS scale_records (
  id BIGSERIAL PRIMARY KEY,
  code INTEGER,
  msg TEXT,
  version TEXT,
  error_type TEXT,
  lefu_body_data JSONB DEFAULT '[]'::jsonb,
  full_data JSONB,
  scale_user_id TEXT,
  goal_summaries JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on created_at for faster time-based queries
CREATE INDEX IF NOT EXISTS idx_scale_records_created_at ON scale_records(created_at DESC);

-- Create index on code for filtering by status
CREATE INDEX IF NOT EXISTS idx_scale_records_code ON scale_records(code);

-- Create GIN index on full_data for JSONB queries
CREATE INDEX IF NOT EXISTS idx_scale_records_full_data ON scale_records USING GIN(full_data);

-- Create GIN index on lefu_body_data for array queries
CREATE INDEX IF NOT EXISTS idx_scale_records_lefu_body_data ON scale_records USING GIN(lefu_body_data);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_scale_records_updated_at BEFORE UPDATE ON scale_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE scale_records IS 'Stores measurement records from Lefu WiFi Torre smart scales';
COMMENT ON COLUMN scale_records.code IS 'Response code from device (200 = success)';
COMMENT ON COLUMN scale_records.msg IS 'Response message from device';
COMMENT ON COLUMN scale_records.version IS 'Device firmware version';
COMMENT ON COLUMN scale_records.error_type IS 'Error type from device (e.g., PP_ERROR_TYPE_NONE)';
COMMENT ON COLUMN scale_records.lefu_body_data IS 'Array of body parameter measurements';
COMMENT ON COLUMN scale_records.full_data IS 'Complete JSON payload from device for reference';
COMMENT ON COLUMN scale_records.scale_user_id IS 'User ID associated with this measurement';
COMMENT ON COLUMN scale_records.goal_summaries IS 'AI-generated summaries for 6 goal cards (General Health, Recovery, Energy, Longevity, Weight Loss, Pain Relief)';

-- Create index on scale_user_id for faster user-based queries
CREATE INDEX IF NOT EXISTS idx_scale_records_scale_user_id ON scale_records(scale_user_id);

-- Create GIN index on goal_summaries for JSONB queries
CREATE INDEX IF NOT EXISTS idx_scale_records_goal_summaries ON scale_records USING GIN(goal_summaries);

