// PILLAR 3 (Mind) — SLEEP QUALITY. 70% device score + 30% REM+deep ratio; fallbacks.
const {
  REM_DEEP_RATIO_CENTRE,
  REM_DEEP_RATIO_SIGMA,
  SLEEP_DURATION_CENTRE_MIN,
  SLEEP_DURATION_SIGMA_MIN,
  SLEEP_EFFICIENCY_CENTRE_PCT,
  SLEEP_EFFICIENCY_SIGMA_PCT,
} = require("../config");
const { sigmoidScore, pyRound } = require("../utils");
const { winsorise } = require("../baseline");

function scoreSleepQuality(today, baseline) {
  const blDur = baseline.sleep_duration_min || {};
  if (!blDur.sleep_ready) return null;

  const parts = [];

  let s = today.sleep_score_0_100;
  if (s != null) {
    s = winsorise(s, baseline.sleep_score_0_100 || {});
    parts.push([sigmoidScore(s, 75.0, 15.0, true), 0.7]);
  }

  const deep = today.deep_sleep_min;
  const rem = today.rem_sleep_min;
  const dur = today.sleep_duration_min;
  if (deep != null && rem != null && dur && dur > 0) {
    const ratio = (Number(deep) + Number(rem)) / Number(dur);
    const remDeepScore = sigmoidScore(ratio, REM_DEEP_RATIO_CENTRE, REM_DEEP_RATIO_SIGMA, true);
    parts.push([remDeepScore, 0.3]);
  }

  if (parts.length) {
    const totalW = parts.reduce((a, [, w]) => a + w, 0);
    return pyRound(parts.reduce((a, [sc, w]) => a + sc * w, 0) / totalW, 2);
  }

  // Fallback: duration + efficiency
  const eff = today.sleep_efficiency_pct;
  if (dur == null && eff == null) return null;
  const fb = [];
  if (dur != null) {
    const durW = winsorise(dur, blDur);
    fb.push(sigmoidScore(durW, SLEEP_DURATION_CENTRE_MIN, SLEEP_DURATION_SIGMA_MIN, true));
  }
  if (eff != null) {
    const effW = winsorise(eff, baseline.sleep_efficiency_pct || {});
    fb.push(sigmoidScore(effW, SLEEP_EFFICIENCY_CENTRE_PCT, SLEEP_EFFICIENCY_SIGMA_PCT, true));
  }
  return fb.length ? pyRound(fb.reduce((a, b) => a + b, 0) / fb.length, 2) : null;
}

module.exports = { scoreSleepQuality };
