const { Queue, Worker } = require("bullmq");
const { generateDailyTasks } = require("./daily-plan-generator");
const { getServiceClient } = require("./supabase");

// ─── Redis Connection ─────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const connection = {
  url: REDIS_URL,
  maxRetriesPerRequest: null,
};

// ─── Queue ────────────────────────────────────────────────────────────────────

const planQueue = new Queue("daily-plan-generation", { connection });

// ─── Worker ───────────────────────────────────────────────────────────────────

let worker = null;

function startWorker() {
  worker = new Worker(
    "daily-plan-generation",
    async (job) => {
      const { userId, planId, triggerType } = job.data;
      console.log(`⚡ [PlanQueue] Processing job ${job.id}: user=${userId} trigger=${triggerType}`);

      try {
        const result = await generateDailyTasks(userId, planId, triggerType);
        console.log(`✅ [PlanQueue] Job ${job.id} completed:`, result);
        return result;
      } catch (err) {
        console.error(`❌ [PlanQueue] Job ${job.id} failed:`, err.message);
        throw err;
      }
    },
    {
      connection,
      concurrency: 3,
      limiter: {
        max: 10,
        duration: 60000, // max 10 jobs per minute
      },
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`❌ [PlanQueue] Job ${job?.id} permanently failed after ${job?.attemptsMade} attempts:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[PlanQueue] Worker error:", err.message);
  });

  console.log("✅ [PlanQueue] Worker started");
}

// ─── Job Scheduling ───────────────────────────────────────────────────────────

/**
 * Schedule a recurring daily job for a time-based plan.
 * Uses BullMQ repeatable jobs with cron syntax.
 * @param {string} userId
 * @param {string} planId
 * @param {string} planTime - "HH:MM" format (user's local time)
 * @param {string} timezone - IANA timezone (e.g., "America/New_York")
 */
async function scheduleDailyPlan(userId, planId, planTime, timezone = "UTC") {
  const [hours, minutes] = planTime.split(":");
  const cronPattern = `${parseInt(minutes)} ${parseInt(hours)} * * *`;

  // Remove any existing schedule for this plan
  await removeScheduledPlan(planId);

  await planQueue.add(
    `daily-${planId}`,
    { userId, planId, triggerType: "scheduled" },
    {
      repeat: {
        pattern: cronPattern,
        tz: timezone,
      },
      jobId: `scheduled-${planId}`,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 30000, // 30s, then 60s, then 120s
      },
      removeOnComplete: { count: 50 }, // keep last 50 completed jobs
      removeOnFail: { count: 20 },
    },
  );

  console.log(`⏰ [PlanQueue] Scheduled daily job for plan ${planId} at ${planTime} ${timezone} (cron: ${cronPattern})`);
}

/**
 * Remove all scheduled jobs for a plan (when plan is deleted/replaced).
 */
async function removeScheduledPlan(planId) {
  try {
    const repeatableJobs = await planQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.name === `daily-${planId}`) {
        await planQueue.removeRepeatableByKey(job.key);
        console.log(`🗑️ [PlanQueue] Removed scheduled job for plan ${planId}`);
      }
    }
  } catch (err) {
    console.warn("[PlanQueue] Error removing scheduled plan:", err.message);
  }
}

/**
 * Queue a one-time immediate job (for day 1 or manual trigger).
 */
async function queueImmediateGeneration(userId, planId, triggerType = "manual") {
  await planQueue.add(
    `immediate-${planId}`,
    { userId, planId, triggerType },
    {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 10000,
      },
      removeOnComplete: true,
      removeOnFail: { count: 10 },
    },
  );

  console.log(`🚀 [PlanQueue] Queued immediate generation for plan ${planId}`);
}

/**
 * Queue generation triggered by sleep webhook (Mode A).
 */
async function queueSleepTriggered(userId, planId) {
  await planQueue.add(
    `sleep-${planId}`,
    { userId, planId, triggerType: "sleep_webhook" },
    {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 15000,
      },
      removeOnComplete: true,
      removeOnFail: { count: 10 },
      // Dedup: if a job for this plan today already exists, skip
      jobId: `sleep-${planId}-${new Date().toISOString().split("T")[0]}`,
    },
  );

  console.log(`😴 [PlanQueue] Queued sleep-triggered generation for plan ${planId}`);
}

/**
 * On server startup, re-schedule all active time-based plans.
 * This ensures jobs survive server restarts.
 */
async function restoreScheduledPlans() {
  const supabase = getServiceClient();
  if (!supabase) {
    console.warn("[PlanQueue] Supabase not configured, skipping schedule restore");
    return;
  }

  try {
    const { data: plans } = await supabase
      .from("action_plans")
      .select("id, user_id, plan_time, timezone")
      .eq("status", "active")
      .eq("generation_mode", "time_based")
      .not("plan_time", "is", null);

    if (!plans?.length) {
      console.log("[PlanQueue] No time-based plans to restore");
      return;
    }

    // Clear all existing repeatable jobs first
    const existingJobs = await planQueue.getRepeatableJobs();
    for (const job of existingJobs) {
      await planQueue.removeRepeatableByKey(job.key);
    }

    for (const plan of plans) {
      const timeStr = plan.plan_time.slice(0, 5); // "HH:MM"
      await scheduleDailyPlan(plan.user_id, plan.id, timeStr, plan.timezone || "UTC");
    }

    console.log(`✅ [PlanQueue] Restored ${plans.length} scheduled plan(s)`);
  } catch (err) {
    console.error("[PlanQueue] Error restoring schedules:", err.message);
  }
}

// ─── Initialize ───────────────────────────────────────────────────────────────

function initPlanQueue() {
  try {
    startWorker();
    restoreScheduledPlans();
    console.log("✅ [PlanQueue] Initialized successfully");
  } catch (err) {
    console.error("❌ [PlanQueue] Failed to initialize:", err.message);
    console.log("   Ensure REDIS_URL is set in environment variables");
  }
}

module.exports = {
  planQueue,
  initPlanQueue,
  scheduleDailyPlan,
  removeScheduledPlan,
  queueImmediateGeneration,
  queueSleepTriggered,
};
