/**
 * Predictive insights pipeline. Gates on Pro (DB status, kept accurate by the
 * subscription reconcile) AND >= 12 scan-days, then runs the scoring engine over
 * Supabase-derived inputs and persists the six daily scores to predictive_scores.
 *
 * Client display gating still runs on the on-device Superwall SDK; this DB gate
 * is the server-side compute gate only.
 */
const { getServiceClient } = require("./supabase");
const { isStatusPro } = require("./live-updates");
const scoring = require("./scoring");
const {
  buildScoringInputs,
  getScanCount,
  MIN_SCANS,
} = require("./scoring-data");

const DAILY_TYPES = ["heart", "movement", "weight", "mind", "oxygen"];
const ALL_TYPES = [...DAILY_TYPES, "lifestyle"];
const DAILY_FN = {
  heart: "scoreHeartCirculation",
  movement: "scoreMovementQuality",
  weight: "scoreWeightManagement",
  mind: "scoreMindFocus",
  oxygen: "scoreOxygenBreathing",
};
const isoDay = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);

async function checkEligibility(userId, { supabase, scanCount } = {}) {
  const sb = supabase || getServiceClient();
  const { data } = await sb
    .from("users")
    .select("subscription_status, subscription_expires_at")
    .eq("id", userId)
    .maybeSingle();
  const isPro = data
    ? isStatusPro(data.subscription_status, data.subscription_expires_at)
    : false;
  const scans = scanCount != null ? scanCount : await getScanCount(sb, userId);
  return {
    eligible: isPro && scans >= MIN_SCANS,
    isPro,
    scanCount: scans,
    needed: MIN_SCANS,
  };
}

function toRow(userId, date, type, result) {
  return {
    user_id: userId,
    score_date: date,
    score_type: type,
    score: result?.score ?? null,
    confidence: result?.confidence ?? null,
    status_chip: result?.status_chip ?? null,
    baseline_status: result?.baseline_status ?? null,
    data_sources_used: result?.data_sources_used ?? [],
    payload: result ?? {},
    updated_at: new Date().toISOString(),
  };
}

async function upsertRows(sb, rows) {
  if (!rows.length) return;
  const { error } = await sb
    .from("predictive_scores")
    .upsert(rows, { onConflict: "user_id,score_date,score_type" });
  if (error) throw error;
}

// The last `days` of persisted daily scores, pivoted to the shape Lifestyle's
// composite_signal wants: [{ date, heart, movement, weight, mind, oxygen }].
async function readScoresHistory(sb, userId, uptoDate, days) {
  const from = new Date(uptoDate);
  from.setDate(from.getDate() - days);
  const { data } = await sb
    .from("predictive_scores")
    .select("score_date, score_type, score")
    .eq("user_id", userId)
    .in("score_type", DAILY_TYPES)
    .gte("score_date", isoDay(from))
    .lte("score_date", uptoDate);
  const byDate = {};
  for (const r of data || []) {
    (byDate[r.score_date] ||= { date: r.score_date })[r.score_type] = r.score;
  }
  return Object.values(byDate).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Compute and persist the six scores for one user (idempotent per day — upserts).
 */
async function computeAndStore(userId, { supabase, todayDate } = {}) {
  const sb = supabase || getServiceClient();
  const inputs = await buildScoringInputs(sb, userId);
  if (!inputs) return { userId, computed: false, reason: "no-inputs" };

  const { today, historyRows, profile } = inputs;
  const date = isoDay(todayDate || today.reading_date || new Date());

  // Five daily scores first so Lifestyle can read them back.
  const daily = {};
  for (const t of DAILY_TYPES) {
    daily[t] = scoring[DAILY_FN[t]](today, historyRows, profile, date);
  }
  await upsertRows(sb, DAILY_TYPES.map((t) => toRow(userId, date, t, daily[t])));

  const scoresHistory = await readScoresHistory(sb, userId, date, 90);
  const lifestyle = scoring.scoreLifestyleIndex(
    today, historyRows, profile, scoresHistory, date,
  );
  await upsertRows(sb, [toRow(userId, date, "lifestyle", lifestyle)]);

  return { userId, computed: true, date, scores: { ...daily, lifestyle } };
}

/**
 * Sweep every eligible user (Pro + >= 12 scan-days) and (re)compute today's
 * scores. Used by the daily cron and the manual trigger.
 */
async function computeAllEligible({ supabase } = {}) {
  const sb = supabase || getServiceClient();
  const { data: users } = await sb
    .from("users")
    .select("id, subscription_status, subscription_expires_at");
  const summary = {
    proUsers: 0,
    computed: 0,
    skippedScans: 0,
    noInputs: 0,
    errors: 0,
  };
  for (const u of users || []) {
    if (!isStatusPro(u.subscription_status, u.subscription_expires_at)) continue;
    summary.proUsers++;
    try {
      const scans = await getScanCount(sb, u.id);
      if (scans < MIN_SCANS) {
        summary.skippedScans++;
        continue;
      }
      const r = await computeAndStore(u.id, { supabase: sb });
      if (r.computed) summary.computed++;
      else summary.noInputs++;
    } catch (e) {
      summary.errors++;
      console.error(`[PredictiveScores] ${u.id} failed:`, e.message);
    }
  }
  return summary;
}

/**
 * Read model for the app: eligibility + the latest score per type with a
 * 7-day trend and the pillar breakdown.
 */
async function getInsights(userId, { supabase } = {}) {
  const sb = supabase || getServiceClient();
  const scanCount = await getScanCount(sb, userId);
  const elig = await checkEligibility(userId, { supabase: sb, scanCount });

  const from = new Date();
  from.setDate(from.getDate() - 30);
  const { data } = await sb
    .from("predictive_scores")
    .select("score_date, score_type, score, confidence, status_chip, baseline_status, payload")
    .eq("user_id", userId)
    .gte("score_date", isoDay(from))
    .order("score_date", { ascending: false });

  const scores = {};
  const trends = {};
  for (const r of data || []) {
    if (!scores[r.score_type]) {
      scores[r.score_type] = {
        score: r.score,
        confidence: r.confidence,
        status_chip: r.status_chip,
        baseline_status: r.baseline_status,
        pillars: r.payload?.pillars || {},
        date: r.score_date,
      };
    }
    (trends[r.score_type] ||= []).push({ date: r.score_date, value: r.score });
  }
  for (const t of Object.keys(scores)) {
    scores[t].trend = (trends[t] || []).slice(0, 7).reverse();
  }

  return { ...elig, scores };
}

module.exports = {
  checkEligibility,
  computeAndStore,
  computeAllEligible,
  getInsights,
  ALL_TYPES,
  DAILY_TYPES,
};
