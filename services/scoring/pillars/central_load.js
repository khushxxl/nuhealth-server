// PILLAR 4 (Heart) — CENTRAL ADIPOSITY LOAD. Visceral fat → trunk fat fallback.
const {
  VISCERAL_FAT_CENTRE,
  VISCERAL_FAT_SIGMA,
  TRUNK_FAT_REFERENCE,
  TRUNK_FAT_SIGMA,
} = require("../config");
const { sigmoidScore, trendScore, pyRound } = require("../utils");
const { winsorise } = require("../baseline");

function scoreCentralLoad(today, baseline, profile) {
  let vf = today.visceral_fat;
  if (vf != null) {
    const bl = baseline.visceral_fat || {};
    vf = winsorise(vf, bl);
    if (bl.trend_ready && bl.mean_14d != null && bl.sd_14d) {
      const pop = sigmoidScore(vf, VISCERAL_FAT_CENTRE, VISCERAL_FAT_SIGMA, false);
      const trnd = trendScore(vf, bl.mean_14d, Math.max(bl.sd_14d, 0.5), true);
      return pyRound(0.7 * pop + 0.3 * trnd, 2);
    }
    return sigmoidScore(vf, VISCERAL_FAT_CENTRE, VISCERAL_FAT_SIGMA, false);
  }

  const tf = today.trunk_fat_ratio_pct;
  if (tf != null) {
    const centre = TRUNK_FAT_REFERENCE[profile.sex] ?? 27.0;
    return sigmoidScore(tf, centre, TRUNK_FAT_SIGMA, false);
  }

  return null;
}

module.exports = { scoreCentralLoad };
