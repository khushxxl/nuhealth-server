// SCORE — HEART & CIRCULATION ACTIVITY (/100). No status_chip.
const { HEART_PILLAR_WEIGHTS, DISCLAIMER, BASELINE } = require("../config");
const { buildBaseline } = require("../baseline");
const { rollupPillars, pillarsBlock } = require("../utils");

const { scoreRestingLoad } = require("../pillars/resting_load");
const { scoreAutonomic } = require("../pillars/autonomic");
const { scoreAerobic } = require("../pillars/aerobic");
const { scoreCentralLoad } = require("../pillars/central_load");
const { scoreSleep } = require("../pillars/sleep");

function scoreHeartCirculation(today, historyRows, profile, todayDate) {
  const baseline = buildBaseline(historyRows, todayDate || new Date());

  const pillarScores = {
    resting_load: scoreRestingLoad(today, baseline, profile),
    autonomic: scoreAutonomic(today, baseline),
    aerobic: scoreAerobic(today, profile),
    central_load: scoreCentralLoad(today, baseline, profile),
    sleep: scoreSleep(today, baseline),
  };

  const [composite, confidence] = rollupPillars(pillarScores, HEART_PILLAR_WEIGHTS);

  const sourcesUsed = [];
  if (["visceral_fat", "trunk_fat_ratio_pct", "fat_ratio_pct"].some((k) => today[k] != null)) {
    sourcesUsed.push("scale");
  }
  if (today.wearable_source) sourcesUsed.push(today.wearable_source);

  const nTotal = (baseline.resting_heart_rate_bpm || {}).n_total || 0;
  let baselineStatus;
  if (nTotal < BASELINE.min_days_for_trend) baselineStatus = "cold_start";
  else if (nTotal < BASELINE.hrv_baseline_days) baselineStatus = "trend_ready";
  else baselineStatus = "full";

  return {
    score: composite,
    confidence,
    pillars: pillarsBlock(HEART_PILLAR_WEIGHTS, pillarScores),
    data_sources_used: sourcesUsed,
    baseline_status: baselineStatus,
    disclaimer: DISCLAIMER,
  };
}

module.exports = { scoreHeartCirculation };
