// PILLAR 3 (Lifestyle) — WEIGHT STABILITY. 90-day CV% of weight (lower = better).
const {
  FIELDS,
  WEIGHT_CV_CENTRE_PCT,
  WEIGHT_CV_SIGMA_PCT,
  LIFESTYLE_WINDOW_DAYS,
  LIFESTYLE_MIN_DAYS_FOR_TREND,
} = require("../config");
const { sigmoidScore } = require("../utils");
const { toUtcMidnightMs, DAY_MS } = require("../baseline");

function scoreWeightStability(historyRows, todayDate) {
  const rows = historyRows || [];
  if (!rows.length) return null;

  const todayMs = toUtcMidnightMs(todayDate || new Date());
  const col = FIELDS.weight_kg || "weight_kg";
  const cutoff = todayMs - LIFESTYLE_WINDOW_DAYS * DAY_MS;

  const window = rows
    .filter((r) => toUtcMidnightMs(r.date) >= cutoff)
    .map((r) => r[col])
    .filter((v) => v != null && Number.isFinite(v));

  if (window.length < LIFESTYLE_MIN_DAYS_FOR_TREND) return null;

  const meanW = window.reduce((a, b) => a + b, 0) / window.length;
  const variance = window.reduce((a, b) => a + (b - meanW) * (b - meanW), 0) / window.length; // ddof=0
  const sdW = Math.sqrt(variance);
  if (meanW <= 0) return null;

  const cvPct = (sdW / meanW) * 100.0;
  return sigmoidScore(cvPct, WEIGHT_CV_CENTRE_PCT, WEIGHT_CV_SIGMA_PCT, false);
}

module.exports = { scoreWeightStability };
