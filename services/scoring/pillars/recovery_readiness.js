// PILLAR 2 (Mind) — RECOVERY READINESS. Device readiness/recovery composite w/ soft floor.
const { READINESS_FLOOR_SCORE } = require("../config");
const { pyRound } = require("../utils");
const { winsorise } = require("../baseline");

function _applyFloor(score) {
  if (score >= READINESS_FLOOR_SCORE) return pyRound(score, 2);
  const compressed =
    (score / READINESS_FLOOR_SCORE) * (READINESS_FLOOR_SCORE / 2) + READINESS_FLOOR_SCORE / 2;
  return pyRound(compressed, 2);
}

function scoreRecoveryReadiness(today, baseline) {
  let readiness = today.readiness_score_0_100;
  let recovery = today.recovery_score_0_100;

  if (readiness != null) {
    readiness = winsorise(readiness, baseline.readiness_score_0_100 || {});
    return _applyFloor(Number(readiness));
  }
  if (recovery != null) {
    recovery = winsorise(recovery, baseline.recovery_score_0_100 || {});
    return _applyFloor(Number(recovery));
  }
  return null;
}

module.exports = { scoreRecoveryReadiness };
