/**
 * BIYO Body Fat Correction - config for classification and param key mapping.
 * Uses exact bodyParamKey values from Lefu API (no pattern matching).
 */

// Body fat % adjustment by bucket (delta to add to raw BF%)
// Bucket values must match Supabase: athlete_very_lean | lean | normal | overweight
const BF_ADJUSTMENT = {
  athlete_very_lean: -4.5,
  lean: -3.5,
  normal: 0,
  overweight: 3.5,
};

// Safety bounds for corrected BF%
const BF_BOUNDS = {
  male: { min: 3, max: 60 },
  female: { min: 10, max: 60 },
};

// Max allowed daily change in BF% (optional; set to null to disable)
const MAX_DAILY_BF_CHANGE = 1.0;

/**
 * Exact bodyParamKey values per role. Only these keys are read/mutated.
 * Global BF% is ppFat only (excludes segmental/ratio keys like ppBodyFatRateTrunk).
 */
const BIYO_EXACT_KEYS = {
  weight: ["ppWeightKg"],
  bodyFatPct: ["ppFat"],
  fatMass: ["ppBodyfatKg"],
  ffm: ["ppLoseFatWeightKg"],
  visceral: ["ppVisceralFat"],
  muscleMass: ["ppMuscleKg", "ppBodySkeletalKg"],
  ffmComponent: [
    "ppWaterKg",
    "ppWaterICWKg",
    "ppWaterECWKg",
    "ppProteinKg",
    "ppMineralKg",
    "ppBoneKg",
    "ppBMR",
    "ppMuscleKgTrunk",
    "ppMuscleKgLeftArm",
    "ppMuscleKgRightArm",
    "ppMuscleKgLeftLeg",
    "ppMuscleKgRightLeg",
    "ppBodySkeletal",
    "ppMusclePercentage",
    "ppProteinPercentage",
    "ppWaterPercentage",
    "ppCellMassKg",
    "ppMuscleKg",
    "ppBodySkeletalKg",
  ],
};

module.exports = {
  BF_ADJUSTMENT,
  BF_BOUNDS,
  MAX_DAILY_BF_CHANGE,
  BIYO_EXACT_KEYS,
};
