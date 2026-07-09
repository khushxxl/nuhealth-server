// PILLAR 1 (Oxygen) — RESPIRATORY RATE STABILITY. Today vs personal 28-day mean.
const { BASELINE, RESP_RATE_SIGMA_BRPM } = require("../config");
const { sigmoidScore } = require("../utils");
const { winsorise } = require("../baseline");

function scoreRespiratoryStability(today, baseline) {
  const rr = today.respiratory_rate_brpm;
  if (rr == null) return null;

  const bl = baseline.respiratory_rate_brpm || {};
  if ((bl.n_total || 0) < BASELINE.min_days_for_trend || bl.mean_28d == null) return null;

  const rrW = winsorise(rr, bl);
  return sigmoidScore(rrW, bl.mean_28d, RESP_RATE_SIGMA_BRPM, false);
}

module.exports = { scoreRespiratoryStability };
