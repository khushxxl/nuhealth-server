// PILLAR 4 (Movement) — DAILY MOVEMENT LOAD. Steps 60% + active-min 40%; Oura fallback.
const { STEPS_CENTRE, STEPS_SIGMA, ACTIVE_MIN_CENTRE, ACTIVE_MIN_SIGMA } = require("../config");
const { sigmoidScore, pyRound } = require("../utils");

function scoreDailyMovement(today) {
  const steps = today.steps;
  const active = today.active_minutes;
  const scoreOura = today.daily_activity_score_0_100;

  const parts = [];
  if (steps != null) parts.push([sigmoidScore(steps, STEPS_CENTRE, STEPS_SIGMA, true), 0.6]);
  if (active != null) parts.push([sigmoidScore(active, ACTIVE_MIN_CENTRE, ACTIVE_MIN_SIGMA, true), 0.4]);

  if (parts.length) {
    const totalW = parts.reduce((a, [, w]) => a + w, 0);
    return pyRound(parts.reduce((a, [s, w]) => a + s * w, 0) / totalW, 2);
  }

  if (scoreOura != null) return sigmoidScore(scoreOura, 75.0, 15.0, true);
  return null;
}

module.exports = { scoreDailyMovement };
