// PILLAR 5 (Oxygen) — ACTIVE BREATHING CAPACITY. High-HR-zone minutes, floor 35.
const { HIGH_HR_MIN_CENTRE, HIGH_HR_MIN_SIGMA, HIGH_HR_FLOOR } = require("../config");
const { sigmoidScore, pyRound } = require("../utils");

function scoreBreathingCapacity(today) {
  let highMin = today.workout_high_hr_minutes;
  if (highMin == null) {
    const secs = today.workout_time_zones_4_5_sec;
    if (secs != null) highMin = Number(secs) / 60.0;
  }

  if (highMin != null) {
    const raw = sigmoidScore(Number(highMin), HIGH_HR_MIN_CENTRE, HIGH_HR_MIN_SIGMA, true);
    return pyRound(Math.max(raw, HIGH_HR_FLOOR), 2);
  }

  const act = today.daily_activity_score_0_100;
  if (act != null) {
    const raw = sigmoidScore(Number(act), 75.0, 15.0, true);
    return pyRound(Math.max(raw, HIGH_HR_FLOOR), 2);
  }

  return null;
}

module.exports = { scoreBreathingCapacity };
