const { getServiceClient } = require("./supabase");
const healthMetrics = require("./health-metrics");

// ─── Pro subscription check (cached briefly) ─────────────────────────────────

const PRO_STATUSES = new Set(["active", "trialing"]);
const proCache = new Map(); // userId -> { isPro, expiresAt }
const PRO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function isProUser(userId) {
  const cached = proCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.isPro;

  const supabase = getServiceClient();
  if (!supabase) return false;

  try {
    const { data, error } = await supabase
      .from("users")
      .select("subscription_status")
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) {
      proCache.set(userId, { isPro: false, expiresAt: Date.now() + PRO_CACHE_TTL });
      return false;
    }

    const isPro = PRO_STATUSES.has(String(data.subscription_status || "").toLowerCase());
    proCache.set(userId, { isPro, expiresAt: Date.now() + PRO_CACHE_TTL });
    return isPro;
  } catch (err) {
    console.warn("[LiveUpdates] Pro check failed:", err.message);
    return false;
  }
}

// ─── Insert helper ────────────────────────────────────────────────────────────

async function createUpdate(userId, message, { category = "general", metricKey, valueNum, metadata } = {}) {
  const supabase = getServiceClient();
  if (!supabase) return null;

  // Gate all live updates behind a Pro subscription
  const pro = await isProUser(userId);
  if (!pro) {
    console.log(`🔒 [LiveUpdates] Skipping update for non-pro user ${userId}`);
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("live_updates")
      .insert([{
        user_id: userId,
        message,
        category,
        metric_key: metricKey || null,
        value_num: valueNum ?? null,
        metadata: metadata || null,
      }])
      .select()
      .single();

    if (error) {
      console.warn("[LiveUpdates] Insert failed:", error.message);
      return null;
    }

    console.log(`💬 [LiveUpdates] ${category}: ${message}`);

    // Push to any connected SSE clients for this user (via Redis pub/sub if available)
    try {
      const { pushToUser } = require("./live-updates-stream");
      await pushToUser(userId, "live-update", data);
    } catch (pushErr) {
      console.warn("[LiveUpdates] SSE push failed:", pushErr.message);
    }

    // Send a push notification ONLY for anomaly category — and only if the user
    // has opted in (live_updates_notifications, default true). Copy is observational.
    if (category === "anomaly") {
      try {
        const { data: user } = await supabase
          .from("users")
          .select("notification_id, live_updates_notifications")
          .eq("id", userId)
          .single();

        const optedIn = user?.live_updates_notifications !== false; // default ON
        if (optedIn && user?.notification_id) {
          const { sendPushNotification } = require("./notification");
          await sendPushNotification(
            user.notification_id,
            "Heads up from Biyo",
            message,
          );
        } else if (!optedIn) {
          console.log(`🔕 [LiveUpdates] User ${userId} opted out of live update notifications`);
        }
      } catch (notifErr) {
        console.warn("[LiveUpdates] Anomaly notification failed:", notifErr.message);
      }
    }

    return data;
  } catch (err) {
    console.warn("[LiveUpdates] Insert error:", err.message);
    return null;
  }
}

// ─── Sleep Insights ───────────────────────────────────────────────────────────

function sleepMessage(score, totalHours) {
  if (score != null) {
    if (score >= 85) return `Excellent sleep score of ${Math.round(score)}, you're well recovered`;
    if (score >= 75) return `Solid sleep score of ${Math.round(score)}, good recovery`;
    if (score >= 65) return `Sleep score of ${Math.round(score)}, try to wind down earlier tonight`;
    return `Sleep score of ${Math.round(score)} is low, prioritize recovery today`;
  }
  if (totalHours != null) {
    if (totalHours < 6) return `Only ${totalHours.toFixed(1)} hrs of sleep, your body needs more rest`;
    if (totalHours < 7) return `${totalHours.toFixed(1)} hrs of sleep, aim for 7-9 hours tonight`;
    return `${totalHours.toFixed(1)} hrs of sleep last night, well rested`;
  }
  return "Sleep data synced from your wearable";
}

async function generateSleepUpdate(userId, metrics) {
  const sleepScore = metrics.find((m) => m.metric_key === "sleep_score")?.value_num;
  const sleepTotal = metrics.find((m) => m.metric_key === "sleep_total")?.value_num;
  const totalHours = sleepTotal ? sleepTotal / 3600 : null;

  await createUpdate(userId, sleepMessage(sleepScore, totalHours), {
    category: "sleep",
    metricKey: "sleep_score",
    valueNum: sleepScore,
    metadata: { totalHours },
  });

  // Anomaly: notably short sleep duration
  if (totalHours != null && totalHours < 5) {
    await createUpdate(
      userId,
      `Last night's sleep was ${totalHours.toFixed(1)} hrs, shorter than your usual range. You might consider extra rest today.`,
      {
        category: "anomaly",
        metricKey: "sleep_total",
        valueNum: totalHours,
      },
    );
  }
}

// ─── Heart Rate Insights ──────────────────────────────────────────────────────

async function generateHeartRateUpdate(userId, metrics) {
  const restingHr = metrics.find((m) => m.metric_key === "hr_resting")?.value_num;
  const hrv = metrics.find((m) => m.metric_key === "hrv")?.value_num;

  if (restingHr != null) {
    let msg;
    if (restingHr < 55) msg = `Resting heart rate of ${Math.round(restingHr)} bpm, excellent cardiovascular fitness`;
    else if (restingHr < 70) msg = `Resting heart rate of ${Math.round(restingHr)} bpm, healthy range`;
    else if (restingHr < 85) msg = `Resting heart rate of ${Math.round(restingHr)} bpm, slightly elevated`;
    else msg = `Resting heart rate of ${Math.round(restingHr)} bpm is high, focus on stress and recovery`;

    await createUpdate(userId, msg, {
      category: "heart_rate",
      metricKey: "hr_resting",
      valueNum: restingHr,
    });

    // Anomaly check: compare to recent average
    try {
      const trend = await healthMetrics.getTrend(userId, "hr_resting", 14).catch(() => null);
      if (trend?.length >= 5) {
        const recent = trend.slice(0, -1); // exclude today
        const avg = recent.reduce((a, b) => a + (b.value_num || 0), 0) / recent.length;
        const diff = restingHr - avg;
        if (Math.abs(diff) > 10) {
          const direction = diff > 0 ? "higher" : "lower";
          await createUpdate(
            userId,
            `Today's resting heart rate (${Math.round(restingHr)} bpm) is ${Math.abs(Math.round(diff))} bpm ${direction} than your recent 14-day average (${Math.round(avg)} bpm).`,
            { category: "anomaly", metricKey: "hr_resting", valueNum: restingHr },
          );
        }
      }
    } catch {
      // ignore
    }
  }

  if (hrv != null) {
    if (hrv < 30) {
      await createUpdate(userId, `HRV of ${Math.round(hrv)} ms is low, your body may be stressed`, {
        category: "heart_rate",
        metricKey: "hrv",
        valueNum: hrv,
      });
    } else if (hrv > 70) {
      await createUpdate(userId, `HRV of ${Math.round(hrv)} ms, strong recovery signal`, {
        category: "heart_rate",
        metricKey: "hrv",
        valueNum: hrv,
      });
    }
  }
}

// ─── Activity Insights ────────────────────────────────────────────────────────

async function generateActivityUpdate(userId, metrics) {
  const steps = metrics.find((m) => m.metric_key === "steps")?.value_num;
  const calories = metrics.find((m) => m.metric_key === "calories_active")?.value_num;
  const strain = metrics.find((m) => m.metric_key === "strain_score")?.value_num;

  if (steps != null) {
    let msg;
    if (steps >= 10000) msg = `${Math.round(steps).toLocaleString()} steps today, you crushed it`;
    else if (steps >= 7000) msg = `${Math.round(steps).toLocaleString()} steps so far, keep it going`;
    else if (steps >= 4000) msg = `${Math.round(steps).toLocaleString()} steps, try a quick walk to hit 10k`;
    else msg = `Only ${Math.round(steps).toLocaleString()} steps today, get moving`;

    await createUpdate(userId, msg, {
      category: "activity",
      metricKey: "steps",
      valueNum: steps,
    });
  }

  if (calories != null && calories > 0) {
    await createUpdate(userId, `Burned ${Math.round(calories)} active calories today`, {
      category: "activity",
      metricKey: "calories_active",
      valueNum: calories,
    });
  }

  if (strain != null) {
    let msg;
    if (strain < 8) msg = `Light strain day (${strain.toFixed(1)}), good for recovery`;
    else if (strain < 14) msg = `Moderate strain (${strain.toFixed(1)}), solid training day`;
    else msg = `High strain of ${strain.toFixed(1)}, make sure to recover well`;

    await createUpdate(userId, msg, {
      category: "activity",
      metricKey: "strain_score",
      valueNum: strain,
    });
  }
}

// ─── Plan-related Updates ─────────────────────────────────────────────────────

async function planGenerated(userId, taskCount, sleepScore) {
  const msg = sleepScore
    ? `Today's plan is ready, ${taskCount} tasks based on your sleep score of ${Math.round(sleepScore)}`
    : `Today's plan is ready, ${taskCount} tasks for you`;
  await createUpdate(userId, msg, { category: "plan", metadata: { taskCount } });
}

async function tasksCompleted(userId, total) {
  await createUpdate(userId, `You completed all ${total} tasks today, great work`, {
    category: "plan",
    metadata: { total },
  });
}

// ─── Main entry: dispatch by category ─────────────────────────────────────────

async function processMetrics(userId, category, metrics) {
  if (!Array.isArray(metrics) || metrics.length === 0) return;

  // Skip processing entirely for non-pro users
  const pro = await isProUser(userId);
  if (!pro) return;

  try {
    if (category === "sleep") {
      await generateSleepUpdate(userId, metrics);
    } else if (category === "physiology" || category === "heart_rate") {
      await generateHeartRateUpdate(userId, metrics);
    } else if (category === "activity") {
      await generateActivityUpdate(userId, metrics);
    }
  } catch (err) {
    console.warn("[LiveUpdates] processMetrics error:", err.message);
  }
}

module.exports = {
  createUpdate,
  processMetrics,
  planGenerated,
  tasksCompleted,
  isProUser,
};
