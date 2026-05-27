const express = require("express");
const router = express.Router();
const { getServiceClient } = require("../services/supabase");
const { success, error } = require("../utils/apiResponse");
const { notify } = require("../services/slack");

// Whitelist of event keys clients are allowed to report. Keeps the endpoint
// from becoming a free Slack-spam channel and keeps the type column small.
const ALLOWED_TYPES = new Set([
  "ble_pairing_failed",
  "wifi_setup_failed",
  "scale_sync_failed",
]);

const TYPE_TITLES = {
  ble_pairing_failed: "Bluetooth pairing failed",
  wifi_setup_failed: "Wi-Fi setup failed",
  scale_sync_failed: "Scale sync failed",
};

/**
 * POST /api/events/report
 * Body: { type: string, reason?: string, details?: object }
 *
 * Forwards user-facing failure events to the ops Slack channel with the
 * caller's id/email attached. Always 200s — observability shouldn't crash
 * the path that triggered it.
 */
router.post("/events/report", async (req, res) => {
  try {
    const { type, reason, details } = req.body || {};
    if (!type || !ALLOWED_TYPES.has(type)) {
      return error(res, "Unknown or missing event type", 400);
    }

    const userId = req.user?.id;
    let email = req.user?.email || null;

    // Pull email from users table if the JWT didn't carry it.
    if (!email && userId) {
      try {
        const supabase = getServiceClient();
        if (supabase) {
          const { data } = await supabase
            .from("users")
            .select("email")
            .eq("id", userId)
            .maybeSingle();
          if (data?.email) email = data.email;
        }
      } catch {
        // best-effort
      }
    }

    // Fire-and-forget — don't await so a slow Slack doesn't slow our 200.
    notify({
      type,
      title: TYPE_TITLES[type] || type,
      reason: typeof reason === "string" ? reason : null,
      userId,
      email,
      details: typeof details === "object" ? details : null,
    });

    return success(res, { received: true });
  } catch (err) {
    console.error("❌ events/report error:", err.message);
    // Always succeed so the client doesn't retry a non-critical analytics call
    return success(res, { received: false });
  }
});

module.exports = router;
