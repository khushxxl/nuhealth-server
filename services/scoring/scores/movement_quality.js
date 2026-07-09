// SCORE — MOVEMENT QUALITY (/100).
const { MOVEMENT_PILLAR_WEIGHTS, DISCLAIMER, BASELINE } = require("../config");
const { buildBaseline } = require("../baseline");
const { rollupPillars, pillarsBlock } = require("../utils");

const { scoreMuscleFoundation } = require("../pillars/muscle_foundation");
const { scoreLimbSymmetry } = require("../pillars/limb_symmetry");
const { scoreLowerBodyReserve } = require("../pillars/lower_body_reserve");
const { scoreDailyMovement } = require("../pillars/daily_movement");
const { scoreRecoveryHeadroom } = require("../pillars/recovery_headroom");

function scoreMovementQuality(today, historyRows, profile, todayDate) {
  const baseline = buildBaseline(historyRows, todayDate || new Date());

  const pillarScores = {
    muscle_foundation: scoreMuscleFoundation(today, profile),
    limb_symmetry: scoreLimbSymmetry(today),
    lower_body_reserve: scoreLowerBodyReserve(today, profile),
    daily_movement: scoreDailyMovement(today),
    recovery_headroom: scoreRecoveryHeadroom(today, baseline),
  };

  const [composite, confidence] = rollupPillars(pillarScores, MOVEMENT_PILLAR_WEIGHTS);

  const sourcesUsed = [];
  if (
    ["skeletal_muscle_mass_kg", "left_leg_muscle_mass_kg", "right_leg_muscle_mass_kg", "muscle_quality_index"].some(
      (k) => today[k] != null
    )
  ) {
    sourcesUsed.push("scale");
  }
  if (today.wearable_source) sourcesUsed.push(today.wearable_source);

  // Python: baseline["hrv_rmssd_ms"].n_total OR baseline["sleep_duration_min"].n_total
  const nTotal =
    (baseline.hrv_rmssd_ms || {}).n_total || (baseline.sleep_duration_min || {}).n_total || 0;
  let baselineStatus;
  if (nTotal < BASELINE.min_days_for_trend) baselineStatus = "cold_start";
  else if (nTotal < BASELINE.hrv_baseline_days) baselineStatus = "trend_ready";
  else baselineStatus = "full";

  return {
    score: composite,
    confidence,
    pillars: pillarsBlock(MOVEMENT_PILLAR_WEIGHTS, pillarScores),
    data_sources_used: sourcesUsed,
    baseline_status: baselineStatus,
    disclaimer: DISCLAIMER,
  };
}

module.exports = { scoreMovementQuality };
