// PILLAR 2 (Weight) — COMPOSITION TREND QUALITY. Fat Δ 60% + muscle Δ 40% over 28d.
const { TREND_FAT_SIGMA_KG, TREND_MUSCLE_SIGMA_KG, BASELINE } = require("../config");
const { pyRound } = require("../utils");
const { winsorise } = require("../baseline");

function _directionScore(deltaKg, sigma, lowerIsBetter) {
  let z = deltaKg / sigma;
  if (lowerIsBetter) z = -z;
  return 100.0 / (1.0 + Math.exp(-z));
}

function scoreTrendQuality(today, baseline) {
  const blFat = baseline.fat_mass_kg || {};
  const blMuscle = baseline.skeletal_muscle_mass_kg || {};

  if ((blFat.n_total || 0) < BASELINE.min_days_for_trend) return null;

  const fatToday = winsorise(today.fat_mass_kg, blFat);
  const muscleToday = winsorise(today.skeletal_muscle_mass_kg, blMuscle);

  const parts = [];
  if (fatToday != null && blFat.mean_28d != null) {
    const fatDelta = fatToday - blFat.mean_28d;
    parts.push([_directionScore(fatDelta, TREND_FAT_SIGMA_KG, true), 0.6]);
  }
  if (muscleToday != null && blMuscle.mean_28d != null) {
    const muscleDelta = muscleToday - blMuscle.mean_28d;
    parts.push([_directionScore(muscleDelta, TREND_MUSCLE_SIGMA_KG, false), 0.4]);
  }

  if (!parts.length) return null;
  const totalW = parts.reduce((a, [, w]) => a + w, 0);
  return pyRound(parts.reduce((a, [s, w]) => a + s * w, 0) / totalW, 2);
}

module.exports = { scoreTrendQuality };
