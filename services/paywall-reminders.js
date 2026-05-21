const { Queue, Worker } = require("bullmq");
const { getServiceClient } = require("./supabase");
const { sendPushNotification } = require("./notification");
const { capture: posthogCapture } = require("./posthog-server");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = { url: REDIS_URL, maxRetriesPerRequest: null };

// Send one paywall nudge every N days to a given free user. The cron sweep
// runs daily; a user only receives a push when at least this many days have
// elapsed since their last reminder (or they've never received one).
const REMINDER_INTERVAL_DAYS = 4;

// Rotation copy from product spec. Each user receives the next entry in
// this list and the index wraps. Each is question-style to maximize tap
// rate; every push deep-links straight to the Biyo+ paywall.
const PAYWALL_MESSAGES = [
  {
    title: "Have you tried RAI?",
    body: "Your personal AI health coach is inside Biyo+. Open to meet it.",
  },
  {
    title: "Ready to hit your goals?",
    body: "Start your Action Plan today with Biyo+.",
  },
  {
    title: "Want to really understand your body?",
    body: "View your trends with Biyo+.",
  },
  {
    title: "Personal trainer too expensive?",
    body: "Personal trainer or nutrition coaching too expensive? We've got you covered with Biyo+.",
  },
  {
    title: "Are your gym gains still not visible?",
    body: "Find out why here — open Biyo+.",
  },
  {
    title: "Your body messaged.",
    body: "It asked: 'Do you still love me?' Tap to open Biyo+.",
  },
];

const PRO_STATUSES = new Set(["active", "trialing"]);

const reminderQueue = new Queue("paywall-reminders", { connection });
const REPEATABLE_JOB_ID = "paywall-reminders-daily";
// 10:00 UTC every day — overlaps morning windows across most timezones without
// hitting Pacific users in the middle of the night.
const CRON_PATTERN = "0 10 * * *";

let worker = null;

function daysSince(iso) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = Date.now() - new Date(iso).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

/**
 * Sweep every non-Pro user and push the next teaser message if they're due.
 * Idempotent across reruns: `last_paywall_reminder_at` is updated only after
 * the message is queued so a re-run within 4 days is a no-op.
 */
async function processPaywallReminders() {
  const supabase = getServiceClient();
  if (!supabase) {
    console.warn("[PaywallReminders] Supabase not configured");
    return { processed: 0, notified: 0 };
  }

  // We only want users who can actually receive a push (have a token) and who
  // haven't opted out of live update notifications. The opt-out flag is the
  // closest existing user-controlled toggle for marketing-style pushes.
  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select(
      "id, notification_id, subscription_status, live_updates_notifications, last_paywall_reminder_at, paywall_reminder_index",
    )
    .not("notification_id", "is", null);

  if (usersErr) {
    console.error(
      "[PaywallReminders] Failed to load users:",
      usersErr.message,
    );
    return { processed: 0, notified: 0 };
  }

  let notified = 0;
  for (const u of users || []) {
    const isPro = PRO_STATUSES.has(
      String(u.subscription_status || "").toLowerCase(),
    );
    if (isPro) continue;

    // Re-use the existing notifications opt-in. If users churn on this, we
    // can split it into a dedicated marketing-opt-in column later.
    if (u.live_updates_notifications === false) continue;

    const elapsed = daysSince(u.last_paywall_reminder_at);
    if (elapsed < REMINDER_INTERVAL_DAYS) continue;

    const idx =
      ((u.paywall_reminder_index || 0) % PAYWALL_MESSAGES.length + PAYWALL_MESSAGES.length) %
      PAYWALL_MESSAGES.length;
    const msg = PAYWALL_MESSAGES[idx];

    let pushOk = false;
    try {
      const result = await sendPushNotification(
        u.notification_id,
        msg.title,
        msg.body,
        { type: "paywall", variant: idx },
      );
      if (result.success) {
        notified += 1;
        pushOk = true;
      }
    } catch (err) {
      console.warn(
        "[PaywallReminders] Push failed for user",
        u.id,
        err.message,
      );
    }

    // Funnel entry event. Pairs with paywall_reminder_opened (client tap)
    // and purchase_success / purchase_cancelled (client paywall result) so
    // we can compute CTR + conversion for each rotating variant.
    if (pushOk) {
      posthogCapture(u.id, "paywall_reminder_sent", {
        placement: "paywall_reminder",
        variant: idx,
        title: msg.title,
      });
    }

    // Bump regardless of delivery success so we don't spam the same user
    // every day with the same variant on transient failures.
    await supabase
      .from("users")
      .update({
        last_paywall_reminder_at: new Date().toISOString(),
        paywall_reminder_index: idx + 1,
      })
      .eq("id", u.id);
  }

  return { processed: (users || []).length, notified };
}

function startPaywallReminderWorker() {
  if (worker) return;
  worker = new Worker(
    "paywall-reminders",
    async () => {
      console.log("⚡ [PaywallReminders] Running daily reminder sweep");
      const result = await processPaywallReminders();
      console.log("✅ [PaywallReminders] Sweep done:", result);
      return result;
    },
    { connection, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    console.error("❌ [PaywallReminders] Job failed:", err.message);
  });
  worker.on("error", (err) => {
    console.error("[PaywallReminders] Worker error:", err.message);
  });

  console.log("✅ [PaywallReminders] Worker started");
}

async function scheduleDailyCron() {
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
    `⏰ [PaywallReminders] Scheduled daily cron at ${CRON_PATTERN} UTC`,
  );
}

async function initPaywallReminders() {
  startPaywallReminderWorker();
  try {
    await scheduleDailyCron();
  } catch (err) {
    console.error("[PaywallReminders] Failed to schedule cron:", err.message);
  }
}

module.exports = {
  initPaywallReminders,
  processPaywallReminders,
  PAYWALL_MESSAGES,
};
