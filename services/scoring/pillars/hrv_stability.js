// PILLAR 1 (Mind) — HRV STABILITY. Today vs personal 28-day mean, σ from config.
const { HRV_STABILITY_RMSSD_SIGMA_MS, HRV_STABILITY_SDNN_SIGMA_MS } = require("../config");
const { sigmoidScore } = require("../utils");
const { winsorise } = require("../baseline");

function _score(value, bl, sigma) {
  if (!bl.hrv_ready || bl.mean_28d == null) return null;
  value = winsorise(value, bl);
  return sigmoidScore(value, bl.mean_28d, sigma, true);
}

function scoreHrvStability(today, baseline) {
  const rmssd = today.hrv_rmssd_ms;
  const sdnn = today.hrv_sdnn_ms;
  if (rmssd != null) return _score(rmssd, baseline.hrv_rmssd_ms || {}, HRV_STABILITY_RMSSD_SIGMA_MS);
  if (sdnn != null) return _score(sdnn, baseline.hrv_sdnn_ms || {}, HRV_STABILITY_SDNN_SIGMA_MS);
  return null;
}

module.exports = { scoreHrvStability };
