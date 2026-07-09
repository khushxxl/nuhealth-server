// PILLAR 3 (Oxygen) — SpO2 STABILITY. Nocturnal SpO2 vs personal baseline, floor 25.
const { BASELINE, SPO2_SIGMA_PCT, SPO2_FLOOR_SCORE } = require("../config");
const { sigmoidScore, pyRound } = require("../utils");
const { winsorise } = require("../baseline");

function scoreSpo2Stability(today, baseline) {
  const spo2 = today.spo2_pct;
  if (spo2 == null) return null;

  const bl = baseline.spo2_pct || {};
  if ((bl.n_total || 0) < BASELINE.min_days_for_trend || bl.mean_28d == null) return null;

  const spo2W = winsorise(spo2, bl);
  const raw = sigmoidScore(spo2W, bl.mean_28d, SPO2_SIGMA_PCT, true);
  return pyRound(Math.max(raw, SPO2_FLOOR_SCORE), 2);
}

module.exports = { scoreSpo2Stability };
