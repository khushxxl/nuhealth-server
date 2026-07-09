const express = require("express");
const router = express.Router();
const { success, error } = require("../utils/apiResponse");
const { getInsights } = require("../services/predictive-scores");

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

module.exports = router;
