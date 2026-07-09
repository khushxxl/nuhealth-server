// SCORE — WEIGHT MANAGEMENT PROGRESS (/100). Descriptive status chip.
const { WEIGHT_PILLAR_WEIGHTS, DISCLAIMER, BASELINE } = require("../config");
const { buildBaseline } = require("../baseline");
const { rollupPillars, pillarsBlock } = require("../utils");

const { scoreCompositionBalance } = require("../pillars/composition_balance");
const { scoreTrendQuality } = require("../pillars/trend_quality");
const { scoreCentralFatTrend } = require("../pillars/central_fat_trend");
const { scoreConsistency } = require("../pillars/consistency");
const { scoreEnergyBalance } = require("../pillars/energy_balance");

function _statusChip(pillarScores, baseline, today) {
  const nTotal = (baseline.fat_ratio_pct || {}).n_total || 0;
  if (nTotal < BASELINE.min_days_for_trend) return "Building baseline";

  const blFat = baseline.fat_mass_kg || {};
  const blMuscle = baseline.skeletal_muscle_mass_kg || {};
  const fatD = (today.fat_mass_kg || 0) - (blFat.mean_28d || 0);
  const musD = (today.skeletal_muscle_mass_kg || 0) - (blMuscle.mean_28d || 0);

  if (fatD < -0.3 && musD > 0.3) return "Recomposing";
  if (musD > 0.3) return "Building muscle";
  if (fatD < -0.3) return "Trending lean";
  if (Math.abs(fatD) <= 0.3 && Math.abs(musD) <= 0.3) return "Holding steady";
  return "Tracking";
}

function scoreWeightManagement(today, historyRows, profile, todayDate) {
  const baseline = buildBaseline(historyRows, todayDate || new Date());

  const pillarScores = {
    composition_balance: scoreCompositionBalance(today, baseline, profile),
    trend_quality: scoreTrendQuality(today, baseline),
    central_fat_trend: scoreCentralFatTrend(today, baseline),
    consistency: scoreConsistency(historyRows, todayDate),
    energy_balance: scoreEnergyBalance(today),
  };

  const [composite, confidence] = rollupPillars(pillarScores, WEIGHT_PILLAR_WEIGHTS);

  const sourcesUsed = [];
  if (
    ["fat_ratio_pct", "fat_mass_kg", "skeletal_muscle_mass_kg", "visceral_fat"].some((k) => today[k] != null)
  ) {
    sourcesUsed.push("scale");
  }
  if (today.wearable_source) sourcesUsed.push(today.wearable_source);

  const nTotal = (baseline.fat_ratio_pct || {}).n_total || 0;
  let baselineStatus;
  if (nTotal < BASELINE.min_days_for_trend) baselineStatus = "cold_start";
  else if (nTotal < BASELINE.hrv_baseline_days) baselineStatus = "trend_ready";
  else baselineStatus = "full";

  return {
    score: composite,
    confidence,
    status_chip: _statusChip(pillarScores, baseline, today),
    pillars: pillarsBlock(WEIGHT_PILLAR_WEIGHTS, pillarScores),
    data_sources_used: sourcesUsed,
    baseline_status: baselineStatus,
    disclaimer: DISCLAIMER,
  };
}

module.exports = { scoreWeightManagement };
