// PILLAR 3 (Heart) — AEROBIC CAPACITY. VO2 max → HR recovery → activity cascade.
const { VO2MAX_REFERENCE, VO2MAX_SIGMA } = require("../config");
const { ageBand, sigmoidScore } = require("../utils");

function scoreAerobic(today, profile) {
  const vo2 = today.vo2_max_ml_kg_min;
  if (vo2 != null) {
    const band = ageBand(profile.age_years);
    const centre = (VO2MAX_REFERENCE[profile.sex] && VO2MAX_REFERENCE[profile.sex][band]) ?? 35.0;
    return sigmoidScore(vo2, centre, VO2MAX_SIGMA, true);
  }

  const hrr = today.hr_recovery_1min_bpm;
  if (hrr != null) return sigmoidScore(hrr, 15.0, 5.0, true);

  const act = today.daily_activity_score_0_100;
  if (act != null) return sigmoidScore(act, 75.0, 15.0, true);

  return null;
}

module.exports = { scoreAerobic };
