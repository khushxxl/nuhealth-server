// PILLAR 4 (Mind) — STRESS SIGNATURE. Nocturnal RHR drift vs personal baseline.
const { BASELINE, STRESS_RHR_SIGMA } = require("../config");
const { sigmoidScore } = require("../utils");
const { winsorise } = require("../baseline");

function _score(value, bl) {
  if ((bl.n_total || 0) < BASELINE.min_days_for_trend || bl.mean_28d == null) return null;
  value = winsorise(value, bl);
  return sigmoidScore(value, bl.mean_28d, STRESS_RHR_SIGMA, false);
}

function scoreStressSignature(today, baseline) {
  const nocturnal = today.sleep_rhr_bpm;
  const daytime = today.resting_heart_rate_bpm;
  if (nocturnal != null) return _score(nocturnal, baseline.sleep_rhr_bpm || {});
  if (daytime != null) return _score(daytime, baseline.resting_heart_rate_bpm || {});
  return null;
}

module.exports = { scoreStressSignature };
