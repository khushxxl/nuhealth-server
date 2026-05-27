const { getServiceClient } = require("./supabase");
const healthMetrics = require("./health-metrics");

// ─── Pro subscription check (cached briefly) ─────────────────────────────────

const PRO_STATUSES = new Set(["active", "trialing"]);
const proCache = new Map(); // userId -> { isPro, cacheExpiresAt }
const PRO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Pure check: combines status + expiry. Returns true only when the user has
 * a Pro-tier status string AND (no expiration set OR expiration is in the
 * future). Catches the case where a webhook for `expiration` was lost or
 * delayed — Apple/Google receipt server stays the source of truth.
 *
 * Exported so callers that already SELECTed both columns (cron sweeps,
 * etc.) can avoid an extra round-trip to isProUser().
 */
function isStatusPro(status, expiresAtIso) {
  if (!PRO_STATUSES.has(String(status || "").toLowerCase())) return false;
  if (!expiresAtIso) return true; // non-renewing purchase or missing expiry
  const expMs = new Date(expiresAtIso).getTime();
  if (!Number.isFinite(expMs)) return true; // unparseable — trust the status
  return expMs > Date.now();
}

async function isProUser(userId) {
  const cached = proCache.get(userId);
  if (cached && cached.cacheExpiresAt > Date.now()) return cached.isPro;

  const supabase = getServiceClient();
  if (!supabase) return false;

  try {
    const { data, error } = await supabase
      .from("users")
      .select("subscription_status, subscription_expires_at")
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) {
      proCache.set(userId, {
        isPro: false,
        cacheExpiresAt: Date.now() + PRO_CACHE_TTL,
      });
      return false;
    }

    const isPro = isStatusPro(
      data.subscription_status,
      data.subscription_expires_at,
    );

    // Cap the cache so it never outlives the subscription itself. If the
    // user expires in 90s, cache for 90s — not the full 5 min — so they
    // lose Pro the moment it actually lapses.
    let cacheExpiresAt = Date.now() + PRO_CACHE_TTL;
    if (isPro && data.subscription_expires_at) {
      const expMs = new Date(data.subscription_expires_at).getTime();
      if (Number.isFinite(expMs) && expMs < cacheExpiresAt) {
        cacheExpiresAt = expMs;
      }
    }

    proCache.set(userId, { isPro, cacheExpiresAt });
    return isPro;
  } catch (err) {
    console.warn("[LiveUpdates] Pro check failed:", err.message);
    return false;
  }
}

// ─── Insert helper ────────────────────────────────────────────────────────────

async function createUpdate(userId, message, { category = "general", metricKey, valueNum, metadata, dedupKey } = {}) {
  const supabase = getServiceClient();
  if (!supabase) return null;

  // Gate all live updates behind a Pro subscription
  const pro = await isProUser(userId);
  if (!pro) {
    console.log(`🔒 [LiveUpdates] Skipping update for non-pro user ${userId}`);
    return null;
  }

  // Dedup: when a dedupKey is supplied, replace today's existing update for
  // that key in place rather than spawning a new card. Stops spam like a
  // dozen "Only X steps today" rows accumulating throughout a single day.
  if (dedupKey) {
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const { data: existing } = await supabase
        .from("live_updates")
        .select("id")
        .eq("user_id", userId)
        .gte("created_at", startOfToday.toISOString())
        .filter("metadata->>dedupKey", "eq", dedupKey)
        .limit(1)
        .maybeSingle();

      if (existing) {
        const mergedMetadata = { ...(metadata || {}), dedupKey };
        const { data: updated, error: updateErr } = await supabase
          .from("live_updates")
          .update({
            message,
            value_num: valueNum ?? null,
            metadata: mergedMetadata,
            created_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select()
          .single();

        if (updateErr) {
          console.warn("[LiveUpdates] Dedup update failed:", updateErr.message);
        } else {
          console.log(`♻️  [LiveUpdates] Refreshed (${dedupKey}): ${message}`);
          try {
            const { pushToUser } = require("./live-updates-stream");
            await pushToUser(userId, "live-update", updated);
          } catch (pushErr) {
            console.warn("[LiveUpdates] SSE push failed:", pushErr.message);
          }
          return updated;
        }
      }
    } catch (dedupErr) {
      console.warn("[LiveUpdates] Dedup lookup error:", dedupErr.message);
      // fall through to insert
    }
  }

  const insertMetadata = dedupKey
    ? { ...(metadata || {}), dedupKey }
    : metadata || null;

  try {
    const { data, error } = await supabase
      .from("live_updates")
      .insert([{
        user_id: userId,
        message,
        category,
        metric_key: metricKey || null,
        value_num: valueNum ?? null,
        metadata: insertMetadata,
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
    let tier;
    if (steps >= 10000) {
      msg = `${Math.round(steps).toLocaleString()} steps today, you crushed it`;
      tier = "crushed";
    } else if (steps >= 7000) {
      msg = `${Math.round(steps).toLocaleString()} steps so far, keep it going`;
      tier = "on-track";
    } else if (steps >= 4000) {
      msg = `${Math.round(steps).toLocaleString()} steps, try a quick walk to hit 10k`;
      tier = "mid";
    } else {
      msg = `Only ${Math.round(steps).toLocaleString()} steps today, get moving`;
      tier = "low";
    }

    await createUpdate(userId, msg, {
      category: "activity",
      metricKey: "steps",
      valueNum: steps,
      dedupKey: `steps:${tier}`,
    });
  }

  if (calories != null && calories > 0) {
    await createUpdate(userId, `Burned ${Math.round(calories)} active calories today`, {
      category: "activity",
      metricKey: "calories_active",
      valueNum: calories,
      dedupKey: "calories_active:daily",
    });
  }

  if (strain != null) {
    let msg;
    let tier;
    if (strain < 8) {
      msg = `Light strain day (${strain.toFixed(1)}), good for recovery`;
      tier = "light";
    } else if (strain < 14) {
      msg = `Moderate strain (${strain.toFixed(1)}), solid training day`;
      tier = "moderate";
    } else {
      msg = `High strain of ${strain.toFixed(1)}, make sure to recover well`;
      tier = "high";
    }

    await createUpdate(userId, msg, {
      category: "activity",
      metricKey: "strain_score",
      valueNum: strain,
      dedupKey: `strain_score:${tier}`,
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
  isStatusPro,
};
