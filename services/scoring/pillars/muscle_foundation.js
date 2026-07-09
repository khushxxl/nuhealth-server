// PILLAR 1 (Movement) — MUSCLE FOUNDATION. SMMI sigmoid × MQI multiplier.
const { SMMI_REFERENCE, SMMI_SIGMA, MQI_NEUTRAL, MQI_SPREAD } = require("../config");
const { sigmoidScore, pyRound } = require("../utils");

function scoreMuscleFoundation(today, profile) {
  const smm = today.skeletal_muscle_mass_kg;
  const heightCm = profile.height_cm;
  if (smm == null || !heightCm) return null;

  const heightM = heightCm / 100.0;
  const smmi = smm / (heightM * heightM);

  const centre = SMMI_REFERENCE[profile.sex] ?? 9.0;
  let base = sigmoidScore(smmi, centre, SMMI_SIGMA, true);

  const mqi = today.muscle_quality_index;
  if (mqi != null) {
    let mult = 1.0 + ((mqi - MQI_NEUTRAL) / MQI_SPREAD) * 0.2;
    mult = Math.max(0.8, Math.min(1.2, mult));
    base = base * mult;
  }

  return pyRound(Math.min(100.0, Math.max(0.0, base)), 2);
}

module.exports = { scoreMuscleFoundation };
