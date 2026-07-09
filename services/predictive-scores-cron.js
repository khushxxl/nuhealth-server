/**
 * Daily BullMQ cron that recomputes predictive insight scores for every
 * eligible user (Pro + >= 12 scan-days). Runs at 07:00 UTC — after the 06:00
 * subscription reconcile, so Pro status is fresh. Mirrors the reconcile cron.
 */
const { Queue, Worker } = require("bullmq");
const { computeAllEligible } = require("./predictive-scores");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = { url: REDIS_URL, maxRetriesPerRequest: null };

const scoresQueue = new Queue("predictive-scores", { connection });
const REPEATABLE_JOB_ID = "predictive-scores-daily";
const CRON_PATTERN = "0 7 * * *";

let worker;

function startWorker() {
  if (worker) return;
  worker = new Worker(
    "predictive-scores",
    async () => {
      console.log("⚡ [PredictiveScores] Running daily score sweep");
      const summary = await computeAllEligible();
      console.log("✅ [PredictiveScores] Sweep done:", summary);
      return summary;
    },
    { connection, concurrency: 1 },
  );
  worker.on("failed", (job, err) => {
    console.error("❌ [PredictiveScores] Job failed:", err.message);
  });
  worker.on("error", (err) => {
    console.error("[PredictiveScores] Worker error:", err.message);
  });
  console.log("✅ [PredictiveScores] Worker started");
}

async function scheduleCron() {
  const existing = await scoresQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.id === REPEATABLE_JOB_ID) {
      await scoresQueue.removeRepeatableByKey(job.key);
    }
  }
  await scoresQueue.add(
    "sweep",
    {},
    {
      repeat: { pattern: CRON_PATTERN, tz: "UTC" },
      jobId: REPEATABLE_JOB_ID,
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 30 },
    },
  );
  console.log(`⏰ [PredictiveScores] Scheduled daily cron at ${CRON_PATTERN} UTC`);
}

async function initPredictiveScores() {
  startWorker();
  try {
    await scheduleCron();
  } catch (err) {
    console.error("[PredictiveScores] Failed to schedule cron:", err.message);
  }
}

module.exports = { initPredictiveScores };
