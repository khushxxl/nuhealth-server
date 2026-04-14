-- Health Metrics table for wearable data (Whoop, Oura, Apple Health, 8Sleep)
-- Biyo Scale data remains in scale_records/scale_measurements

CREATE TABLE IF NOT EXISTS health_metrics (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  value_num NUMERIC,
  value_text TEXT,
  unit TEXT DEFAULT '',
  recorded_at TIMESTAMPTZ NOT NULL,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookups: latest metrics per category for a user
CREATE INDEX idx_hm_user_category ON health_metrics(user_id, category, recorded_at DESC);

-- Fast lookups: trend data for a specific metric
CREATE INDEX idx_hm_user_metric ON health_metrics(user_id, metric_key, recorded_at DESC);

-- Prevent duplicate writes from webhook retries
CREATE UNIQUE INDEX idx_hm_dedup ON health_metrics(user_id, source, metric_key, recorded_at);

-- Source filtering
CREATE INDEX idx_hm_source ON health_metrics(source);

-- Add CHECK constraints for valid sources and categories
ALTER TABLE health_metrics ADD CONSTRAINT chk_hm_source
  CHECK (source IN ('whoop', 'oura', 'apple_health', '8sleep'));

ALTER TABLE health_metrics ADD CONSTRAINT chk_hm_category
  CHECK (category IN ('physiology', 'activity', 'recovery', 'sleep'));
