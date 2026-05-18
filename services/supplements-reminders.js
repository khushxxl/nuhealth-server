const { Queue, Worker } = require("bullmq");
const { getServiceClient } = require("./supabase");
const { sendPushNotification } = require("./notification");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = { url: REDIS_URL, maxRetriesPerRequest: null };

// Mirrors the values in routes/biyo-supplements.js — kept here so the cron is
// self-contained and doesn't need to import from the route module.
const PACKAGE_SIZE = 30;
const REMINDER_AT_DAYS_LEFT = [7, 3];
const REORDER_URL = "https://biyo.com/pages/longevity";

const reminderQueue = new Queue("supplements-reorder-reminders", { connection });

const REPEATABLE_JOB_ID = "supplements-reorder-reminders-daily";
// Daily at 09:00 UTC — early enough to land in a user's morning regardless
// of their timezone, since we don't yet persist a per-user reminder time for
// supplements.
const CRON_PATTERN = "0 9 * * *";

let worker = null;

function todayKey() {
  return new Date().toISOString().split("T")[0];
}

/**
 * Iterate every active supplement-tracking row, compute doses remaining for
 * the current package, and send a push when the user crosses the 7-doses or
 * 3-doses threshold (idempotent via the *_sent booleans).
 */
async function processReorderReminders() {
  const supabase = getServiceClient();
  if (!supabase) {
    console.warn("[SupReminders] Supabase not configured, skipping");
    return { processed: 0, notified: 0 };
  }

  const { data: trackers, error: trackErr } = await supabase
    .from("biyo_supplements_tracking")
    .select(
      "user_id, current_package_started_at, started_at, reorder_reminder_7_sent, reorder_reminder_3_sent, reorder_reminders_enabled",
    )
    .eq("active", true);

  if (trackErr) {
    console.error("[SupReminders] Failed to load trackers:", trackErr.message);
    return { processed: 0, notified: 0 };
  }

  let notified = 0;
  const today = todayKey();

  for (const t of trackers || []) {
    // User opted out of reorder pushes from the tracker toggle — skip
    // notifying but still track flags so they don't fire retroactively if
    // they re-enable later.
    if (t.reorder_reminders_enabled === false) continue;

    const packageStartIso = t.current_package_started_at || t.started_at;
    if (!packageStartIso) continue;
    const packageStartDate = packageStartIso.split("T")[0];

    const { count: dosesTaken } = await supabase
      .from("biyo_supplements_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", t.user_id)
      .gte("taken_date", packageStartDate)
      .lte("taken_date", today);

    const dosesRemaining = Math.max(0, PACKAGE_SIZE - (dosesTaken || 0));

    let triggered = null;
    if (
      REMINDER_AT_DAYS_LEFT.includes(dosesRemaining) === false &&
      dosesRemaining <= 7 &&
      !t.reorder_reminder_7_sent
    ) {
      // User started tracking partway through a bottle and is already inside
      // the last-week window — fire the 7-day reminder once on first sight.
      triggered = 7;
    } else if (dosesRemaining === 7 && !t.reorder_reminder_7_sent) {
      triggered = 7;
    } else if (dosesRemaining === 3 && !t.reorder_reminder_3_sent) {
      triggered = 3;
    }

    if (!triggered) continue;

    // Look up push token + opt-in flag (re-use the live-updates pref since we
    // don't have a dedicated supplements toggle yet).
    const { data: user } = await supabase
      .from("users")
      .select("notification_id, live_updates_notifications")
      .eq("id", t.user_id)
      .maybeSingle();

    const optedIn = user?.live_updates_notifications !== false;
    if (optedIn && user?.notification_id) {
      const title =
        triggered === 7
          ? "Your Biyo Longevity is running low"
          : "Only 3 days left in your bottle";
      const body =
        triggered === 7
          ? `You have ${dosesRemaining} days left. Reorder now so you don't miss a day.`
          : `Reorder Biyo Longevity today to keep your streak going. ${REORDER_URL}`;
      try {
        await sendPushNotification(user.notification_id, title, body);
        notified += 1;
      } catch (notifErr) {
        console.warn(
          "[SupReminders] Push failed for user",
          t.user_id,
          notifErr.message,
        );
      }
    }

    // Flip the flag regardless of whether the push actually delivered — we
    // don't want to retry on subsequent days for the same threshold.
    const patch =
      triggered === 7
        ? { reorder_reminder_7_sent: true }
        : { reorder_reminder_3_sent: true };
    await supabase
      .from("biyo_supplements_tracking")
      .update(patch)
      .eq("user_id", t.user_id);
  }

  return { processed: (trackers || []).length, notified };
}

function startReorderReminderWorker() {
  if (worker) return;
  worker = new Worker(
    "supplements-reorder-reminders",
    async () => {
      console.log("⚡ [SupReminders] Running daily reorder reminder sweep");
      const result = await processReorderReminders();
      console.log("✅ [SupReminders] Sweep done:", result);
      return result;
    },
    { connection, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    console.error("❌ [SupReminders] Job failed:", err.message);
  });
  worker.on("error", (err) => {
    console.error("[SupReminders] Worker error:", err.message);
  });

  console.log("✅ [SupReminders] Worker started");
}

async function scheduleReorderReminderCron() {
  // Clear any older variants of the repeatable job so cron changes apply.
  const existing = await reminderQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.id === REPEATABLE_JOB_ID) {
      await reminderQueue.removeRepeatableByKey(job.key);
    }
  }

  await reminderQueue.add(
    "sweep",
    {},
    {
      repeat: { pattern: CRON_PATTERN, tz: "UTC" },
      jobId: REPEATABLE_JOB_ID,
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 30 },
    },
  );
  console.log(
    `⏰ [SupReminders] Scheduled daily cron at ${CRON_PATTERN} UTC`,
  );
}

async function initSupplementsReminders() {
  startReorderReminderWorker();
  try {
    await scheduleReorderReminderCron();
  } catch (err) {
    console.error("[SupReminders] Failed to schedule cron:", err.message);
  }
}

module.exports = {
  initSupplementsReminders,
  processReorderReminders, // exported for manual triggering / testing
};
