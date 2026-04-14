const express = require("express");
const router = express.Router();
const { success, error } = require("../utils/apiResponse");
const healthMetrics = require("../services/health-metrics");

// GET /api/health-metrics/latest?category=sleep&source=whoop&limit=50
router.get("/health-metrics/latest", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return error(res, "Unauthorized", 401);

    const { category, source, limit } = req.query;
    const data = await healthMetrics.getLatest(userId, {
      category: category || undefined,
      source: source || undefined,
      limit: limit ? parseInt(limit, 10) : 50,
    });

    return success(res, data);
  } catch (err) {
    console.error("❌ GET /health-metrics/latest error:", err.message);
    return error(res, "Failed to fetch health metrics");
  }
});

// GET /api/health-metrics/category/:category — latest value per metric in a category
router.get("/health-metrics/category/:category", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return error(res, "Unauthorized", 401);

    const { category } = req.params;
    const validCategories = ["physiology", "activity", "recovery", "sleep"];
    if (!validCategories.includes(category)) {
      return error(res, `Invalid category: ${category}`, 400);
    }

    const data = await healthMetrics.getLatestByCategory(userId, category);
    return success(res, data);
  } catch (err) {
    console.error(`❌ GET /health-metrics/category/${req.params.category} error:`, err.message);
    return error(res, "Failed to fetch category metrics");
  }
});

// GET /api/health-metrics/trend?metricKey=hr_resting&limit=30
router.get("/health-metrics/trend", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return error(res, "Unauthorized", 401);

    const { metricKey, limit } = req.query;
    if (!metricKey) return error(res, "metricKey is required", 400);

    const data = await healthMetrics.getTrend(userId, metricKey, limit ? parseInt(limit, 10) : 30);
    return success(res, data);
  } catch (err) {
    console.error("❌ GET /health-metrics/trend error:", err.message);
    return error(res, "Failed to fetch trend data");
  }
});

// GET /api/health-metrics/sources — which wearables have data
router.get("/health-metrics/sources", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return error(res, "Unauthorized", 401);

    const sources = await healthMetrics.getSources(userId);
    return success(res, sources);
  } catch (err) {
    console.error("❌ GET /health-metrics/sources error:", err.message);
    return error(res, "Failed to fetch sources");
  }
});

module.exports = router;
