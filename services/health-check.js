const { getServiceClient } = require("./supabase");

/**
 * Centralised health probe used by:
 *   - `GET /health`           public uptime endpoint
 *   - `/health` Slack command on-demand status check
 *   - `slack-heartbeat.js`    every-2-hours auto ping
 *
 * Returns a single object so every surface renders identical data.
 */
async function gatherHealthStatus() {
  const startedAt = Date.now();

  const result = {
    status: "healthy", // flips to "unhealthy" if any required check fails
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    environment: process.env.SLACK_ENV_LABEL || process.env.NODE_ENV || "unknown",
    memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    services: {
      database: { status: "unknown", message: "Not checked" },
      redis: { status: "unknown", message: "Not checked" },
    },
    checkMs: 0,
  };

  // ── Database ──────────────────────────────────────────────────────────
  const supabase = getServiceClient();
  if (!supabase) {
    result.services.database = {
      status: "unhealthy",
      message: "Supabase client not configured",
    };
    result.status = "unhealthy";
  } else {
    try {
      const { error } = await supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .limit(1);
      if (error) {
        result.services.database = {
          status: "unhealthy",
          message: `DB query failed: ${error.message}`,
        };
        result.status = "unhealthy";
      } else {
        result.services.database = { status: "healthy", message: "OK" };
      }
    } catch (err) {
      result.services.database = {
        status: "unhealthy",
        message: `DB check threw: ${err.message}`,
      };
      result.status = "unhealthy";
    }
  }

  // ── Redis (BullMQ) ────────────────────────────────────────────────────
  // Optional — only checked if REDIS_URL is set. Lots of background work
  // depends on Redis so a failure here matters.
  if (process.env.REDIS_URL) {
    try {
      const IORedis = require("ioredis");
      const redis = new IORedis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        lazyConnect: true,
      });
      await redis.connect();
      const pong = await redis.ping();
      await redis.quit();
      if (pong === "PONG") {
        result.services.redis = { status: "healthy", message: "PONG" };
      } else {
        result.services.redis = {
          status: "unhealthy",
          message: `Unexpected ping response: ${pong}`,
        };
        result.status = "unhealthy";
      }
    } catch (err) {
      result.services.redis = {
        status: "unhealthy",
        message: `Redis check failed: ${err.message}`,
      };
      result.status = "unhealthy";
    }
  } else {
    result.services.redis = {
      status: "skipped",
      message: "REDIS_URL not configured",
    };
  }

  result.checkMs = Date.now() - startedAt;
  return result;
}

/**
 * Format a duration in seconds as `12h 34m` for human display.
 */
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

module.exports = { gatherHealthStatus, formatUptime };
