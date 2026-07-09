/**
 * Twice-daily BullMQ cron that reconciles every user's subscription status
 * against the Superwall API (the source of truth). Mirrors the paywall-reminder
 * cron wiring. The per-user reconcile also runs on purchase (from the webhook),
 * so this sweep exists to catch drift the webhook can't observe in real time:
 * silent renewals, lapses, refunds, and purchases that orphaned under an
 * anonymous alias before the account was linked.
 */
const { Queue, Worker } = require("bullmq");
const { getServiceClient } = require("./supabase");
const { reconcileAll } = require("./subscription-reconcile");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = { url: REDIS_URL, maxRetriesPerRequest: null };

const reconcileQueue = new Queue("subscription-reconcile", { connection });
const REPEATABLE_JOB_ID = "subscription-reconcile-twice-daily";
// 06:00 and 18:00 UTC — twice a day.
const CRON_PATTERN = "0 6,18 * * *";

let worker;

function startWorker() {
  if (worker) return;
  worker = new Worker(
    "subscription-reconcile",
    async () => {
      console.log("⚡ [SubReconcile] Running subscription reconcile sweep");
      const summary = await reconcileAll(getServiceClient(), { concurrency: 8 });
      console.log("✅ [SubReconcile] Sweep done:", summary);
      return summary;
    },
    { connection, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    console.error("❌ [SubReconcile] Job failed:", err.message);
  });
  worker.on("error", (err) => {
    console.error("[SubReconcile] Worker error:", err.message);
  });

  console.log("✅ [SubReconcile] Worker started");
}

async function scheduleCron() {
  const existing = await reconcileQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.id === REPEATABLE_JOB_ID) {
      await reconcileQueue.removeRepeatableByKey(job.key);
    }
  }
  await reconcileQueue.add(
    "sweep",
    {},
    {
      repeat: { pattern: CRON_PATTERN, tz: "UTC" },
      jobId: REPEATABLE_JOB_ID,
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 30 },
    },
  );
  console.log(`⏰ [SubReconcile] Scheduled reconcile cron at ${CRON_PATTERN} UTC`);
}

async function initSubscriptionReconcile() {
  startWorker();
  try {
    await scheduleCron();
  } catch (err) {
    console.error("[SubReconcile] Failed to schedule cron:", err.message);
  }
}

module.exports = { initSubscriptionReconcile, reconcileQueue };
