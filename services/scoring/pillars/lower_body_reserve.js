// PILLAR 3 (Movement) — LOWER-BODY RESERVE. Leg-SMMI vs sex reference.
const { LEG_SMMI_REFERENCE, LEG_SMMI_SIGMA } = require("../config");
const { sigmoidScore } = require("../utils");

function scoreLowerBodyReserve(today, profile) {
  const l = today.left_leg_muscle_mass_kg;
  const r = today.right_leg_muscle_mass_kg;
  const heightCm = profile.height_cm;
  if (l == null || r == null || !heightCm) return null;

  const heightM = heightCm / 100.0;
  const legSmmi = (l + r) / (heightM * heightM);
  const centre = LEG_SMMI_REFERENCE[profile.sex] ?? 3.7;
  return sigmoidScore(legSmmi, centre, LEG_SMMI_SIGMA, true);
}

module.exports = { scoreLowerBodyReserve };
