// SCORE — MIND & FOCUS TRENDS (/100).
const { MIND_PILLAR_WEIGHTS, DISCLAIMER, BASELINE } = require("../config");
const { buildBaseline } = require("../baseline");
const { rollupPillars, pillarsBlock } = require("../utils");

const { scoreHrvStability } = require("../pillars/hrv_stability");
const { scoreRecoveryReadiness } = require("../pillars/recovery_readiness");
const { scoreSleepQuality } = require("../pillars/sleep_quality");
const { scoreStressSignature } = require("../pillars/stress_signature");
const { scoreMindfulEngagement } = require("../pillars/mindful_engagement");

function _statusChip(composite, baseline) {
  const rmssd = baseline.hrv_rmssd_ms || {};
  const sdnn = baseline.hrv_sdnn_ms || {};
  const hrvNights = Math.max(rmssd.n_total || 0, sdnn.n_total || 0);

  if (hrvNights < BASELINE.min_nights_for_hrv) return "Building baseline";
  if (composite == null) return "Building baseline";
  if (composite >= 75) return "Settled";
  if (composite >= 55) return "Steady";
  if (composite >= 40) return "Variable day";
  return "Recovering";
}

function scoreMindFocus(today, historyRows, profile, todayDate) {
  const baseline = buildBaseline(historyRows, todayDate || new Date());

  const pillarScores = {
    hrv_stability: scoreHrvStability(today, baseline),
    recovery_readiness: scoreRecoveryReadiness(today, baseline),
    sleep_quality: scoreSleepQuality(today, baseline),
    stress_signature: scoreStressSignature(today, baseline),
    mindful_engagement: scoreMindfulEngagement(today, baseline),
  };

  const [composite, confidence] = rollupPillars(pillarScores, MIND_PILLAR_WEIGHTS);

  const sourcesUsed = [];
  if (today.wearable_source) sourcesUsed.push(today.wearable_source);
  if (today.mindfulness_minutes != null && !sourcesUsed.includes("apple_health")) {
    sourcesUsed.push("apple_health");
  }

  const rmssd = baseline.hrv_rmssd_ms || {};
  const sdnn = baseline.hrv_sdnn_ms || {};
  const hrvNights = Math.max(rmssd.n_total || 0, sdnn.n_total || 0);
  let baselineStatus;
  if (hrvNights < BASELINE.min_nights_for_hrv) baselineStatus = "cold_start";
  else if (hrvNights < BASELINE.hrv_baseline_days) baselineStatus = "trend_ready";
  else baselineStatus = "full";

  return {
    score: composite,
    confidence,
    status_chip: _statusChip(composite, baseline),
    pillars: pillarsBlock(MIND_PILLAR_WEIGHTS, pillarScores),
    data_sources_used: sourcesUsed,
    baseline_status: baselineStatus,
    disclaimer: DISCLAIMER,
  };
}

module.exports = { scoreMindFocus };
