// PILLAR 2 (Movement) — LIMB SYMMETRY. Avg arm+leg L/R % difference.
const { SYMMETRY_CENTRE_PCT, SYMMETRY_SIGMA_PCT } = require("../config");
const { sigmoidScore } = require("../utils");

function _pctDiff(a, b) {
  if (a == null || b == null || Math.max(a, b) <= 0) return null;
  return (Math.abs(a - b) / Math.max(a, b)) * 100.0;
}

function scoreLimbSymmetry(today) {
  const armDiff = _pctDiff(today.left_arm_muscle_mass_kg, today.right_arm_muscle_mass_kg);
  const legDiff = _pctDiff(today.left_leg_muscle_mass_kg, today.right_leg_muscle_mass_kg);

  const diffs = [armDiff, legDiff].filter((d) => d != null);
  if (!diffs.length) return null;

  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return sigmoidScore(avgDiff, SYMMETRY_CENTRE_PCT, SYMMETRY_SIGMA_PCT, false);
}

module.exports = { scoreLimbSymmetry };
