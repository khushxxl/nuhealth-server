// PILLAR 5 (Heart) — SLEEP. Device composite → duration + efficiency fallback.
const {
  SLEEP_DURATION_CENTRE_MIN,
  SLEEP_DURATION_SIGMA_MIN,
  SLEEP_EFFICIENCY_CENTRE_PCT,
  SLEEP_EFFICIENCY_SIGMA_PCT,
} = require("../config");
const { sigmoidScore, pyRound } = require("../utils");
const { winsorise } = require("../baseline");

function scoreSleep(today, baseline) {
  const blDur = baseline.sleep_duration_min || {};
  if (!blDur.sleep_ready) return null;

  let s = today.sleep_score_0_100;
  if (s != null) {
    s = winsorise(s, baseline.sleep_score_0_100 || {});
    return sigmoidScore(s, 75.0, 15.0, true);
  }

  let dur = today.sleep_duration_min;
  let eff = today.sleep_efficiency_pct;
  if (dur == null && eff == null) return null;

  const parts = [];
  if (dur != null) {
    dur = winsorise(dur, blDur);
    parts.push(sigmoidScore(dur, SLEEP_DURATION_CENTRE_MIN, SLEEP_DURATION_SIGMA_MIN, true));
  }
  if (eff != null) {
    eff = winsorise(eff, baseline.sleep_efficiency_pct || {});
    parts.push(sigmoidScore(eff, SLEEP_EFFICIENCY_CENTRE_PCT, SLEEP_EFFICIENCY_SIGMA_PCT, true));
  }
  return parts.length ? pyRound(parts.reduce((a, b) => a + b, 0) / parts.length, 2) : null;
}

module.exports = { scoreSleep };
