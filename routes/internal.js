const express = require("express");
const router = express.Router();
const { success, error } = require("../utils/apiResponse");
const { processPaywallReminders } = require("../services/paywall-reminders");
const { reconcileAll } = require("../services/subscription-reconcile");
const { getServiceClient } = require("../services/supabase");

// Internal/admin endpoints. Mounted BEFORE the JWT authMiddleware, so they are
// guarded instead by a shared secret in the `x-admin-secret` header. Set
// ADMIN_TRIGGER_SECRET in the server env to enable; unset = disabled (503).
function requireAdminSecret(req, res) {
  const secret = process.env.ADMIN_TRIGGER_SECRET;
  if (!secret) {
    error(res, "Manual trigger disabled (ADMIN_TRIGGER_SECRET not set)", 503);
    return false;
  }
  if (req.headers["x-admin-secret"] !== secret) {
    error(res, "Unauthorized", 401);
    return false;
  }
  return true;
}

/**
 * POST /internal/paywall-reminders/run
 * Fires the paywall-nudge sweep on demand (same logic as the daily cron).
 * Safe to call anytime: the sweep still respects the 4-day per-user cooldown,
 * so it won't double-send. Useful to verify sends / recover if the BullMQ cron
 * has stalled, without waiting for the 10:00 UTC schedule.
 */
router.post("/paywall-reminders/run", async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  try {
    const result = await processPaywallReminders();
    return success(res, result, "Paywall reminder sweep complete");
  } catch (err) {
    console.error("[Internal] paywall-reminders run failed:", err.message);
    return error(res, "Sweep failed", 500);
  }
});

/**
 * POST /internal/subscriptions/reconcile
 * Runs the full subscription reconcile sweep on demand (same logic as the
 * twice-daily cron): every user is checked against the Superwall API and their
 * subscription_status / expiry corrected. Safe to call anytime.
 */
router.post("/subscriptions/reconcile", async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  try {
    const summary = await reconcileAll(getServiceClient(), { concurrency: 8 });
    return success(res, summary, "Subscription reconcile complete");
  } catch (err) {
    console.error("[Internal] subscription reconcile failed:", err.message);
    return error(res, "Reconcile failed", 500);
  }
});

module.exports = router;
