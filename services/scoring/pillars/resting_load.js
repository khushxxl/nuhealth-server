// PILLAR 1 (Heart) — RESTING CARDIOVASCULAR LOAD. Wearable RHR only.
const { RHR_REFERENCE, RHR_SIGMA_BPM } = require("../config");
const { ageBand, sigmoidScore, trendScore } = require("../utils");
const { winsorise } = require("../baseline");

function scoreRestingLoad(today, baseline, profile) {
  let rhr = today.resting_heart_rate_bpm;
  if (rhr == null) return null;

  const bl = baseline.resting_heart_rate_bpm || {};
  rhr = winsorise(rhr, bl);

  if (bl.trend_ready && bl.mean_14d != null && bl.sd_14d) {
    return trendScore(rhr, bl.mean_14d, Math.max(bl.sd_14d, 2.0), true);
  }

  const band = ageBand(profile.age_years);
  const centre = (RHR_REFERENCE[profile.sex] && RHR_REFERENCE[profile.sex][band]) ?? 70;
  return sigmoidScore(rhr, centre, RHR_SIGMA_BPM, false);
}

module.exports = { scoreRestingLoad };
