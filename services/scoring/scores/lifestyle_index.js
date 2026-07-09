// SCORE — LONG-TERM LIFESTYLE INDEX (/100).
const {
  LIFESTYLE_PILLAR_WEIGHTS,
  DISCLAIMER,
  LIFESTYLE_MIN_DAYS_FOR_TREND,
  LIFESTYLE_WINDOW_DAYS,
} = require("../config");
const { buildBaseline, toUtcMidnightMs, DAY_MS } = require("../baseline");
const { rollupPillars, pillarsBlock } = require("../utils");

const { scoreCompositeSignal } = require("../pillars/composite_signal");
const { scoreBodyAgeTrend } = require("../pillars/body_age_trend");
const { scoreWeightStability } = require("../pillars/weight_stability");
const { scoreHabitConsistency } = require("../pillars/habit_consistency");
const { scoreActivityHabit } = require("../pillars/activity_habit");

function _statusChip(composite, nDays) {
  if (nDays < LIFESTYLE_MIN_DAYS_FOR_TREND) return "Building baseline";
  if (composite == null) return "Building baseline";
  if (composite >= 75) return "Strong pattern";
  if (composite >= 55) return "Steady pattern";
  if (composite >= 40) return "Mixed pattern";
  return "Building pattern";
}

function scoreLifestyleIndex(today, historyRows, profile, scoresHistory, todayDate) {
  const td = todayDate || new Date();
  const baseline = buildBaseline(historyRows, td);

  const pillarScores = {
    composite_signal: scoreCompositeSignal(scoresHistory, td),
    body_age_trend: scoreBodyAgeTrend(today, baseline, profile),
    weight_stability: scoreWeightStability(historyRows, td),
    habit_consistency: scoreHabitConsistency(historyRows, td),
    activity_habit: scoreActivityHabit(historyRows, td),
  };

  const [composite, confidence] = rollupPillars(pillarScores, LIFESTYLE_PILLAR_WEIGHTS);

  const sourcesUsed = [];
  if (
    ["fat_ratio_pct", "fat_mass_kg", "skeletal_muscle_mass_kg", "body_age_years"].some((k) => today[k] != null)
  ) {
    sourcesUsed.push("scale");
  }
  if (today.wearable_source) sourcesUsed.push(today.wearable_source);

  // Maturity keyed on calendar span of history (today − earliest reading + 1)
  let nTotal = 0;
  const rows = historyRows || [];
  if (rows.length) {
    let earliestMs = Infinity;
    for (const r of rows) {
      const ms = toUtcMidnightMs(r.date);
      if (ms < earliestMs) earliestMs = ms;
    }
    const tdMs = toUtcMidnightMs(td);
    nTotal = Math.round((tdMs - earliestMs) / DAY_MS) + 1;
  }

  let baselineStatus;
  if (nTotal < LIFESTYLE_MIN_DAYS_FOR_TREND) baselineStatus = "cold_start";
  else if (nTotal < LIFESTYLE_WINDOW_DAYS) baselineStatus = "trend_ready";
  else baselineStatus = "full";

  return {
    score: composite,
    confidence,
    status_chip: _statusChip(composite, nTotal),
    pillars: pillarsBlock(LIFESTYLE_PILLAR_WEIGHTS, pillarScores),
    data_sources_used: sourcesUsed,
    baseline_status: baselineStatus,
    disclaimer: DISCLAIMER,
  };
}

module.exports = { scoreLifestyleIndex };
