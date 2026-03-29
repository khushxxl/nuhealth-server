-- Add subscription fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'none';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_product_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_store TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_period_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_cancel_reason TEXT;

-- Create index for quick subscription status lookups
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users (subscription_status);

-- Create subscription_events audit table for raw webhook storage
CREATE TABLE IF NOT EXISTS subscription_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE, -- Superwall event ID for idempotency
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  product_id TEXT,
  price NUMERIC,
  proceeds NUMERIC,
  currency_code TEXT,
  store TEXT,
  environment TEXT,
  period_type TEXT,
  transaction_id TEXT,
  original_transaction_id TEXT,
  expiration_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying events by user
CREATE INDEX IF NOT EXISTS idx_subscription_events_user_id ON subscription_events (user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_event_type ON subscription_events (event_type);

-- Comment for documentation
COMMENT ON COLUMN users.subscription_status IS 'Subscription state: none, trialing, active, cancelled, expired, billing_issue, paused';
