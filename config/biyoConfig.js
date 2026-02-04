/**
 * BIYO Body Fat Correction - config for classification and param key mapping.
 * Lefu API may use camelCase or snake_case; keys are matched case-insensitively.
 * Update paramKeyPatterns if your API returns different field names.
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
 * Param key patterns: item is treated as this role if bodyParamKey matches (includes) any pattern.
 * Order matters for disambiguation (e.g. check 'fatmass' before 'fat').
 */
const PARAM_KEY_PATTERNS = {
  weight: ["weight", "weightkg", "ppweight"],
  bodyFatPct: ["bodyfat", "body_fat", "bfpct", "fatpct", "ppbodyfat", "bf_percent"],
  fatMass: ["fatmass", "fat_mass", "ppfatmass"],
  ffm: ["ffm", "fatfreemass", "fat_free_mass", "ppffm"],
  muscleMass: ["muscle", "skeletal", "musclemass", "skeletalmuscle", "ppmuscle", "ppmusclemass"],
  visceral: ["visceral", "visceralfat", "ppvisceral"],
  // FFM components (scaled by k)
  tbw: ["tbw", "water", "bodywater", "totalbodywater", "pptbw"],
  protein: ["protein", "ppprotein"],
  mineral: ["mineral", "bone", "ppmineral", "ppbone"],
  bmr: ["bmr", "basal", "ppbmr"],
  // Segmental lean (arms, legs, trunk)
  segmentalLean: ["arm", "leg", "trunk", "segmental", "leanarm", "leanleg", "leantrunk"],
};

module.exports = {
  BF_ADJUSTMENT,
  BF_BOUNDS,
  MAX_DAILY_BF_CHANGE,
  PARAM_KEY_PATTERNS,
};
