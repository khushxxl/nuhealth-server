// PILLAR 5 (Weight) — ENERGY BALANCE. Steps 60% + active-min 40% activity signal.
const { STEPS_CENTRE, STEPS_SIGMA, ACTIVE_MIN_CENTRE, ACTIVE_MIN_SIGMA } = require("../config");
const { sigmoidScore, pyRound } = require("../utils");

function scoreEnergyBalance(today) {
  const steps = today.steps;
  const active = today.active_minutes;
  if (steps == null && active == null) return null;

  const parts = [];
  if (steps != null) parts.push([sigmoidScore(steps, STEPS_CENTRE, STEPS_SIGMA, true), 0.6]);
  if (active != null) parts.push([sigmoidScore(active, ACTIVE_MIN_CENTRE, ACTIVE_MIN_SIGMA, true), 0.4]);

  const totalW = parts.reduce((a, [, w]) => a + w, 0);
  return pyRound(parts.reduce((a, [s, w]) => a + s * w, 0) / totalW, 2);
}

module.exports = { scoreEnergyBalance };
