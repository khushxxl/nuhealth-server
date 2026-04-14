-- Add unique constraint on (user_id, device_name) for wearable upserts
-- This allows the same user to have one entry per device/wearable
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_user_device_name
  ON devices(user_id, device_name);
