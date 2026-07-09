// PILLAR 3 (Weight) — CENTRAL FAT TREND. Visceral (or trunk) fat 28-day direction.
const { BASELINE } = require("../config");
const { trendScore } = require("../utils");
const { winsorise } = require("../baseline");

function scoreCentralFatTrend(today, baseline) {
  const vf = today.visceral_fat;
  const vfBl = baseline.visceral_fat || {};
  const trunk = today.trunk_fat_ratio_pct;
  const trunkBl = baseline.trunk_fat_ratio_pct || {};

  if (vf != null && (vfBl.n_total || 0) >= BASELINE.min_days_for_trend && vfBl.mean_28d != null) {
    const vfW = winsorise(vf, vfBl);
    return trendScore(vfW, vfBl.mean_28d, Math.max(vfBl.sd_28d || 0.5, 0.5), true);
  }

  if (trunk != null && (trunkBl.n_total || 0) >= BASELINE.min_days_for_trend && trunkBl.mean_28d != null) {
    const tW = winsorise(trunk, trunkBl);
    return trendScore(tW, trunkBl.mean_28d, Math.max(trunkBl.sd_28d || 1.0, 1.0), true);
  }

  return null;
}

module.exports = { scoreCentralFatTrend };
