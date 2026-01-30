-- Migration: Add goal_summaries column and scale_user_id index to scale_records table
-- Run this SQL in your Supabase SQL Editor if the table already exists
-- This migration adds support for AI-generated goal card summaries

-- Add scale_user_id column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'scale_records' AND column_name = 'scale_user_id'
  ) THEN
    ALTER TABLE scale_records ADD COLUMN scale_user_id TEXT;
  END IF;
END $$;

-- Add goal_summaries column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'scale_records' AND column_name = 'goal_summaries'
  ) THEN
    ALTER TABLE scale_records ADD COLUMN goal_summaries JSONB;
  END IF;
END $$;

-- Create index on scale_user_id if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_scale_records_scale_user_id ON scale_records(scale_user_id);

-- Create GIN index on goal_summaries if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_scale_records_goal_summaries ON scale_records USING GIN(goal_summaries);

-- Add comments
COMMENT ON COLUMN scale_records.scale_user_id IS 'User ID associated with this measurement';
COMMENT ON COLUMN scale_records.goal_summaries IS 'AI-generated summaries for 6 goal cards (General Health, Recovery, Energy, Longevity, Weight Loss, Pain Relief)';

