const express = require("express");
const router = express.Router();
const { success, error } = require("../utils/apiResponse");
const {
  getInsights,
  computeAndStore,
  checkEligibility,
  getMetricHistory,
} = require("../services/predictive-scores");

/**
 * GET /api/insights
 * Predictive insights for the authenticated user: eligibility (Pro + scan
 * count) plus the latest score per type with a 7-day trend and pillar
 * breakdown. When not eligible, `scores` may be empty and the client shows the
 * paywall blur (not Pro) or the "X/12 scans" building state.
 */
router.get("/insights", async (req, res) => {
  try {
    const withMetrics = req.query.metrics === "1";
    const data = await getInsights(req.user.id, { withMetrics });
    return success(res, data, "Insights");
  } catch (err) {
    console.error("[Insights] failed:", err.message);
    return error(res, "Failed to load insights", 500);
  }
});

/**
 * POST /api/insights/generate
 * On-demand score generation for the authenticated user — a resilience fallback
 * so a user is never stuck if the daily cron stalls or hasn't run yet. Gated on
 * the same eligibility (Pro + >= 12 scan-days); when not eligible it just
 * returns the eligibility state so the client shows the blur / building screen.
 * Returns the freshly computed insights on success.
 */
router.post("/insights/generate", async (req, res) => {
  try {
    const userId = req.user.id;
    const elig = await checkEligibility(userId);
    if (!elig.eligible) {
      return success(res, { ...elig, generated: false, scores: {} }, "Not eligible");
    }
    await computeAndStore(userId);
    const data = await getInsights(userId);
    return success(res, { ...data, generated: true }, "Insights generated");
  } catch (err) {
    console.error("[Insights] generate failed:", err.message);
    return error(res, "Failed to generate insights", 500);
  }
});

/**
 * GET /api/insights/metric?key=<snapshotKey>&days=30
 * History for a single KPI metric (scale or wearable) so the Deep-dive tiles can
 * tap through to a real trend. Resolves the same way the scores do.
 */
router.get("/insights/metric", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!key) return error(res, "Missing metric key", 400);
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 180);
    const data = await getMetricHistory(req.user.id, key, { days });
    return success(res, data, "Metric history");
  } catch (err) {
    console.error("[Insights] metric history failed:", err.message);
    return error(res, "Failed to load metric history", 500);
  }
});

module.exports = router;
