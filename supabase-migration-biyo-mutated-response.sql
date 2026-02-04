-- Migration: Add mutated_response to scale_records for BIYO-corrected body data
-- Run this SQL in your Supabase SQL Editor

-- 1. scale_records: store BIYO-corrected body data (scale_measurements use this)
ALTER TABLE scale_records
ADD COLUMN IF NOT EXISTS mutated_response JSONB DEFAULT NULL;

COMMENT ON COLUMN scale_records.mutated_response IS 'BIYO-corrected body data array; scale_measurements are built from this. Raw Lefu response remains in lefu_body_data.';

-- 2. users: optional body type for classification override (athlete / lean / normal / overweight)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS user_body_type TEXT;

COMMENT ON COLUMN users.user_body_type IS 'Optional override for BIYO bucket. Allowed: athlete_very_lean, lean, normal, overweight.';

-- Optional: GIN index if you query by mutated_response
-- CREATE INDEX IF NOT EXISTS idx_scale_records_mutated_response ON scale_records USING GIN(mutated_response);
