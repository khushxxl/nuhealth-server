// SCORE — OXYGEN & BREATHING TRENDS (/100).
const { OXYGEN_PILLAR_WEIGHTS, DISCLAIMER, BASELINE } = require("../config");
const { buildBaseline } = require("../baseline");
const { rollupPillars, pillarsBlock } = require("../utils");

const { scoreRespiratoryStability } = require("../pillars/respiratory_stability");
const { scoreAerobic } = require("../pillars/aerobic");
const { scoreSpo2Stability } = require("../pillars/spo2_stability");
const { scoreSleepOxygenation } = require("../pillars/sleep_oxygenation");
const { scoreBreathingCapacity } = require("../pillars/breathing_capacity");

function _statusChip(composite, baseline) {
  const rrNights = (baseline.respiratory_rate_brpm || {}).n_total || 0;
  if (rrNights < BASELINE.min_nights_for_hrv) return "Building baseline";
  if (composite == null) return "Building baseline";
  if (composite >= 75) return "Strong";
  if (composite >= 55) return "Steady";
  if (composite >= 40) return "Variable";
  return "Watching";
}

function scoreOxygenBreathing(today, historyRows, profile, todayDate) {
  const baseline = buildBaseline(historyRows, todayDate || new Date());

  const pillarScores = {
    respiratory_stability: scoreRespiratoryStability(today, baseline),
    aerobic_capacity: scoreAerobic(today, profile), // reused from Heart
    spo2_stability: scoreSpo2Stability(today, baseline),
    sleep_oxygenation: scoreSleepOxygenation(today, baseline),
    breathing_capacity: scoreBreathingCapacity(today),
  };

  const [composite, confidence] = rollupPillars(pillarScores, OXYGEN_PILLAR_WEIGHTS);

  const sourcesUsed = [];
  if (today.wearable_source) sourcesUsed.push(today.wearable_source);

  const rrNights = (baseline.respiratory_rate_brpm || {}).n_total || 0;
  let baselineStatus;
  if (rrNights < BASELINE.min_nights_for_hrv) baselineStatus = "cold_start";
  else if (rrNights < BASELINE.hrv_baseline_days) baselineStatus = "trend_ready";
  else baselineStatus = "full";

  return {
    score: composite,
    confidence,
    status_chip: _statusChip(composite, baseline),
    pillars: pillarsBlock(OXYGEN_PILLAR_WEIGHTS, pillarScores),
    data_sources_used: sourcesUsed,
    baseline_status: baselineStatus,
    disclaimer: DISCLAIMER,
  };
}

module.exports = { scoreOxygenBreathing };
