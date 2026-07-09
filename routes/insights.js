const express = require("express");
const router = express.Router();
const { success, error } = require("../utils/apiResponse");
const {
  getInsights,
  computeAndStore,
  checkEligibility,
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
    const data = await getInsights(req.user.id);
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

module.exports = router;
