// PILLAR 5 (Movement) — RECOVERY HEADROOM. Autonomic 60% + sleep 40%.
const { scoreAutonomic } = require("./autonomic");
const { scoreSleep } = require("./sleep");
const { pyRound } = require("../utils");

function scoreRecoveryHeadroom(today, baseline) {
  const auto = scoreAutonomic(today, baseline);
  const sleep = scoreSleep(today, baseline);

  if (auto == null && sleep == null) return null;
  if (auto == null) return pyRound(sleep, 2);
  if (sleep == null) return pyRound(auto, 2);
  return pyRound(0.6 * auto + 0.4 * sleep, 2);
}

module.exports = { scoreRecoveryHeadroom };
