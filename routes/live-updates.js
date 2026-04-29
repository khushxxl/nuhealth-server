const express = require("express");
const router = express.Router();
const { getServiceClient } = require("../services/supabase");
const { addConnection } = require("../services/live-updates-stream");
const { success, error } = require("../utils/apiResponse");

/**
 * GET /api/live-updates
 * Returns the latest live updates for the authenticated user
 * Query: limit (default 20)
 */
router.get("/live-updates", async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const supabase = getServiceClient();
    if (!supabase) return error(res, "Database not configured", 500);

    // Only return updates from the last 24 hours (rolling "today" window)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error: err } = await supabase
      .from("live_updates")
      .select("id, message, category, metric_key, value_num, metadata, created_at")
      .eq("user_id", userId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (err) return error(res, "Failed to fetch updates", 500);

    return success(res, { updates: data || [] });
  } catch (err) {
    console.error("Live updates error:", err.message);
    return error(res, "Failed to fetch live updates", 500);
  }
});

/**
 * GET /api/live-updates/stream
 * Server-Sent Events stream — pushes new live_updates rows to the client in realtime.
 * Auth is via the standard Bearer header (handled by global authMiddleware).
 */
router.get("/live-updates/stream", (req, res) => {
  const userId = req.user.id;

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering

  // Initial handshake event so the client knows the stream is open
  res.write(`event: ready\ndata: {"userId":"${userId}"}\n\n`);

  // Register this connection
  const removeConnection = addConnection(userId, res);

  // Heartbeat every 25s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    removeConnection();
  });
});

/**
 * POST /api/live-updates/test
 * Dev/testing endpoint — creates a fake live update for the authenticated user
 * so you can verify the realtime SSE flow.
 */
router.post("/live-updates/test", async (req, res) => {
  try {
    const userId = req.user.id;
    const message =
      req.body?.message || `Test update at ${new Date().toLocaleTimeString()}`;
    const category = req.body?.category || "general";

    const { createUpdate } = require("../services/live-updates");
    const result = await createUpdate(userId, message, { category });

    if (!result) {
      return error(res, "Update was skipped (likely non-pro user)", 200);
    }
    return success(res, { update: result });
  } catch (err) {
    console.error("Test update error:", err.message);
    return error(res, "Failed to create test update", 500);
  }
});

module.exports = router;
