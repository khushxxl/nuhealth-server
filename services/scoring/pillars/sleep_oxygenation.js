// PILLAR 4 (Oxygen) — SLEEP OXYGENATION. 60% resp-rate stability + 40% sleep efficiency.
const {
  BASELINE,
  RESP_RATE_SIGMA_BRPM,
  SLEEP_EFFICIENCY_CENTRE_PCT,
  SLEEP_EFFICIENCY_SIGMA_PCT,
} = require("../config");
const { sigmoidScore, pyRound } = require("../utils");
const { winsorise } = require("../baseline");

function scoreSleepOxygenation(today, baseline) {
  const parts = [];

  const rr = today.respiratory_rate_brpm;
  const blRr = baseline.respiratory_rate_brpm || {};
  if (rr != null && (blRr.n_total || 0) >= BASELINE.min_days_for_trend && blRr.mean_28d != null) {
    const rrW = winsorise(rr, blRr);
    parts.push([sigmoidScore(rrW, blRr.mean_28d, RESP_RATE_SIGMA_BRPM, false), 0.6]);
  }

  const eff = today.sleep_efficiency_pct;
  if (eff != null) {
    const effW = winsorise(eff, baseline.sleep_efficiency_pct || {});
    parts.push([sigmoidScore(effW, SLEEP_EFFICIENCY_CENTRE_PCT, SLEEP_EFFICIENCY_SIGMA_PCT, true), 0.4]);
  }

  if (!parts.length) return null;
  const totalW = parts.reduce((a, [, w]) => a + w, 0);
  return pyRound(parts.reduce((a, [s, w]) => a + s * w, 0) / totalW, 2);
}

module.exports = { scoreSleepOxygenation };
