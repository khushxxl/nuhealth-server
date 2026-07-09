/**
 * =============================================================================
 * BIYO SCORING — SHARED UTILITIES  (JS port of utils.py)
 * =============================================================================
 * Sigmoid, age-banding, pillar roll-up, plus a Python-faithful round().
 * =============================================================================
 */

/**
 * Emulate Python 3's built-in round(x, ndigits): round-half-to-even (banker's
 * rounding). Python operates on the true decimal value; we approximate by
 * detecting the exact-half case within a tiny epsilon and rounding to even.
 * For non-half values, standard rounding matches Python (both act on the same
 * IEEE-754 double).
 */
function pyRound(x, ndigits = 0) {
  if (x === null || x === undefined || !Number.isFinite(x)) return x;
  const m = Math.pow(10, ndigits);
  const scaled = x * m;
  const floorVal = Math.floor(scaled);
  const frac = scaled - floorVal;
  const EPS = 1e-9;
  let rounded;
  if (Math.abs(frac - 0.5) < EPS) {
    rounded = floorVal % 2 === 0 ? floorVal : floorVal + 1; // round half to even
  } else {
    rounded = Math.round(scaled);
  }
  return rounded / m;
}

function ageBand(ageYears) {
  if (ageYears < 30) return "18-29";
  if (ageYears < 40) return "30-39";
  if (ageYears < 50) return "40-49";
  if (ageYears < 60) return "50-59";
  if (ageYears < 70) return "60-69";
  return "70+";
}

/**
 * Logistic 0-100 score around a reference centre.
 *   value == centre     → 50
 *   value == centre + σ  → ~73 (higher_is_better) / ~27 otherwise
 */
function sigmoidScore(value, centre, sigma, higherIsBetter = false) {
  let z = (value - centre) / sigma;
  if (!higherIsBetter) z = -z;
  const score = 100.0 / (1.0 + Math.exp(-z * 1.0));
  return pyRound(score, 2);
}

/**
 * Person-relative score: 50 ± (deviation from baseline in SDs × 25), clamped.
 */
function trendScore(
  todayValue,
  baselineMean,
  baselineSd,
  lowerIsBetter = true,
  maxSwing = 40.0
) {
  if (baselineSd === null || baselineSd === undefined || baselineSd === 0) {
    return 50.0;
  }
  let z = (todayValue - baselineMean) / baselineSd;
  if (lowerIsBetter) z = -z;
  const score = 50.0 + Math.max(-maxSwing, Math.min(maxSwing, z * 25.0));
  return pyRound(score, 2);
}

/**
 * Weighted average over AVAILABLE pillars only. Missing pillars (value null)
 * drop out and weights renormalise across the remainder.
 * Returns [compositeScore | null, confidence].
 */
function rollupPillars(pillarScores, weights) {
  const contributing = [];
  for (const k of Object.keys(pillarScores)) {
    const v = pillarScores[k];
    if (v !== null && v !== undefined && Object.prototype.hasOwnProperty.call(weights, k)) {
      contributing.push([v, weights[k]]);
    }
  }
  if (contributing.length === 0) return [null, 0.0];
  const totalW = contributing.reduce((a, [, w]) => a + w, 0);
  const score = contributing.reduce((a, [v, w]) => a + v * w, 0) / totalW;
  const confidence = contributing.reduce((a, [, w]) => a + w, 0);
  return [pyRound(score, 1), pyRound(confidence, 2)];
}

/**
 * Build the per-pillar output block { name: {score, weight, available} } in the
 * weight dict's key order, matching each orchestrator's dict comprehension.
 * available === (score is not None).
 */
function pillarsBlock(weights, scores) {
  const out = {};
  for (const name of Object.keys(weights)) {
    const sc = scores[name] === undefined ? null : scores[name];
    out[name] = { score: sc, weight: weights[name], available: sc != null };
  }
  return out;
}

module.exports = { pyRound, ageBand, sigmoidScore, trendScore, rollupPillars, pillarsBlock };
