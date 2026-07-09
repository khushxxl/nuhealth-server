// PILLAR 2 (Lifestyle) — BODY AGE TREND. 28-day body-age mean vs chronological.
const { LIFESTYLE_MIN_DAYS_FOR_TREND, BODY_AGE_DELTA_SIGMA_YEARS } = require("../config");
const { sigmoidScore } = require("../utils");

function scoreBodyAgeTrend(today, baseline, profile) {
  const bl = baseline.body_age_years || {};
  const chronological = profile.age_years;

  if (chronological == null) return null;
  if ((bl.n_total || 0) < LIFESTYLE_MIN_DAYS_FOR_TREND) return null;
  if (bl.mean_28d == null) return null;

  const delta = bl.mean_28d - Number(chronological);
  return sigmoidScore(delta, 0.0, BODY_AGE_DELTA_SIGMA_YEARS, false);
}

module.exports = { scoreBodyAgeTrend };
