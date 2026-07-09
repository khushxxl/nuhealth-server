// PILLAR 2 (Heart) — AUTONOMIC RESILIENCE (HRV). Person-relative only.
const { trendScore } = require("../utils");
const { winsorise } = require("../baseline");

function _scoreOne(value, bl) {
  if (!bl.hrv_ready || bl.mean_28d == null || !bl.sd_28d) return null;
  value = winsorise(value, bl);
  return trendScore(value, bl.mean_28d, Math.max(bl.sd_28d, 3.0), false);
}

function scoreAutonomic(today, baseline) {
  const rmssd = today.hrv_rmssd_ms;
  const sdnn = today.hrv_sdnn_ms;
  if (rmssd != null) return _scoreOne(rmssd, baseline.hrv_rmssd_ms || {});
  if (sdnn != null) return _scoreOne(sdnn, baseline.hrv_sdnn_ms || {});
  return null;
}

module.exports = { scoreAutonomic };
