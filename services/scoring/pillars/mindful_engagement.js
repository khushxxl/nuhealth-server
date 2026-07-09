// PILLAR 5 (Mind) — MINDFUL ENGAGEMENT. Soft signal, floor at 50.
const { MINDFUL_MIN_CENTRE, MINDFUL_MIN_SIGMA, MINDFUL_FLOOR_SCORE } = require("../config");
const { sigmoidScore, pyRound } = require("../utils");
const { winsorise } = require("../baseline");

function scoreMindfulEngagement(today, baseline) {
  const mindful = today.mindfulness_minutes;
  let balance = today.activity_balance_0_100;

  const parts = [];
  if (mindful != null) {
    const raw = sigmoidScore(Number(mindful), MINDFUL_MIN_CENTRE, MINDFUL_MIN_SIGMA, true);
    parts.push(Math.max(raw, MINDFUL_FLOOR_SCORE));
  }
  if (balance != null) {
    balance = winsorise(balance, baseline.activity_balance_0_100 || {});
    parts.push(Math.max(Number(balance), MINDFUL_FLOOR_SCORE));
  }

  if (!parts.length) return null;
  return pyRound(parts.reduce((a, b) => a + b, 0) / parts.length, 2);
}

module.exports = { scoreMindfulEngagement };
