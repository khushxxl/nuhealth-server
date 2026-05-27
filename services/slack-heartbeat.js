const { Queue, Worker } = require("bullmq");
const { notify } = require("./slack");
const { gatherHealthStatus, formatUptime } = require("./health-check");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = { url: REDIS_URL, maxRetriesPerRequest: null };

const heartbeatQueue = new Queue("slack-heartbeat", { connection });
const REPEATABLE_JOB_ID = "slack-heartbeat-2h";
// Every 2 hours, on the hour: 00, 02, 04, ...
const CRON_PATTERN = "0 */2 * * *";

let worker = null;

async function postHeartbeat() {
  const status = await gatherHealthStatus();
  const isHealthy = status.status === "healthy";

  await notify({
    type: isHealthy ? "server_heartbeat" : "server_unhealthy",
    title: isHealthy
      ? "Server heartbeat — healthy"
      : "Server heartbeat — UNHEALTHY",
    reason: isHealthy ? undefined : "One or more health checks failed",
    details: {
      Database: `${status.services.database.status} — ${status.services.database.message}`,
      Redis: `${status.services.redis.status} — ${status.services.redis.message}`,
      Uptime: formatUptime(status.uptimeSeconds),
      Memory: `${status.memoryMb} MB`,
      Environment: status.environment,
      Node: status.nodeVersion,
      CheckMs: `${status.checkMs} ms`,
    },
  });
}

function startWorker() {
  if (worker) return;
  worker = new Worker(
    "slack-heartbeat",
    async () => {
      console.log("💓 [Heartbeat] Posting Slack server-status ping");
      await postHeartbeat();
    },
    { connection, concurrency: 1 },
  );
  worker.on("failed", (job, err) => {
    console.error("❌ [Heartbeat] Job failed:", err.message);
  });
  worker.on("error", (err) => {
    console.error("[Heartbeat] Worker error:", err.message);
  });
  console.log("✅ [Heartbeat] Worker started");
}

async function scheduleCron() {
  // Clear older variants so cron pattern changes always take effect.
  const existing = await heartbeatQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.id === REPEATABLE_JOB_ID) {
      await heartbeatQueue.removeRepeatableByKey(job.key);
    }
  }
  await heartbeatQueue.add(
    "ping",
    {},
    {
      repeat: { pattern: CRON_PATTERN, tz: "UTC" },
      jobId: REPEATABLE_JOB_ID,
      removeOnComplete: { count: 24 },
      removeOnFail: { count: 24 },
    },
  );
  console.log(`⏰ [Heartbeat] Scheduled at cron ${CRON_PATTERN} UTC`);
}

async function initSlackHeartbeat() {
  startWorker();
  try {
    await scheduleCron();
  } catch (err) {
    console.error("[Heartbeat] Failed to schedule cron:", err.message);
  }
}

module.exports = { initSlackHeartbeat, postHeartbeat };
