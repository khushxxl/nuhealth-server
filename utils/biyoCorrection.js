/**
 * BIYO Body Fat Correction - classification, BF% adjustment, and FFM rebalancing.
 * Uses only structural indicators (no raw BF%) for classification; then corrects BF%
 * and scales all FFM-derived metrics so Fat_new + FFM_new = Weight.
 */

const {
  BF_ADJUSTMENT,
  BF_BOUNDS,
  MAX_DAILY_BF_CHANGE,
  PARAM_KEY_PATTERNS,
} = require("../config/biyoConfig");

function getParamKey(item) {
  return (
    item?.bodyParamKey ??
    item?.body_param_key ??
    item?.bodyParam ??
    item?.body_param ??
    ""
  );
}

function getCurrentValue(item) {
  const v =
    item?.currentValue !== undefined
      ? item.currentValue
      : item?.current_value !== undefined
        ? item.current_value
        : null;
  if (v === null || v === undefined) return null;
  const num = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(num) ? num : null;
}

function setCurrentValue(item, value) {
  const num = Number(value);
  if ("currentValue" in item) item.currentValue = num;
  if ("current_value" in item) item.current_value = num;
  if (!("currentValue" in item) && !("current_value" in item))
    item.currentValue = num;
}

/** Normalize key for matching (lowercase, no spaces) */
function normalizeKey(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/\s/g, "");
}

/** Determine the role of a body data item from its param key */
function getItemRole(paramKey) {
  const k = normalizeKey(paramKey);
  if (!k) return null;
  if (PARAM_KEY_PATTERNS.weight.some((p) => k.includes(p))) return "weight";
  if (PARAM_KEY_PATTERNS.bodyFatPct.some((p) => k.includes(p)))
    return "bodyFatPct";
  if (PARAM_KEY_PATTERNS.fatMass.some((p) => k.includes(p))) return "fatMass";
  if (PARAM_KEY_PATTERNS.ffm.some((p) => k.includes(p))) return "ffm";
  if (PARAM_KEY_PATTERNS.visceral.some((p) => k.includes(p))) return "visceral";
  if (PARAM_KEY_PATTERNS.muscleMass.some((p) => k.includes(p)))
    return "muscleMass";
  if (PARAM_KEY_PATTERNS.tbw.some((p) => k.includes(p))) return "ffmComponent";
  if (PARAM_KEY_PATTERNS.protein.some((p) => k.includes(p)))
    return "ffmComponent";
  if (PARAM_KEY_PATTERNS.mineral.some((p) => k.includes(p)))
    return "ffmComponent";
  if (PARAM_KEY_PATTERNS.bmr.some((p) => k.includes(p))) return "ffmComponent";
  if (PARAM_KEY_PATTERNS.segmentalLean.some((p) => k.includes(p)))
    return "ffmComponent";
  return null;
}

/**
 * Extract metrics needed for classification and rebalancing from raw body data.
 * Also needs height (cm) and weight (kg) from request/profile.
 */
function extractMetrics(bodyData, weightKg, heightCm) {
  const out = {
    weight:
      weightKg != null && Number.isFinite(Number(weightKg))
        ? Number(weightKg)
        : null,
    height:
      heightCm != null && Number.isFinite(Number(heightCm))
        ? Number(heightCm) / 100
        : null,
    bfPct: null,
    fatMass: null,
    ffm: null,
    muscleMass: null,
    visceral: null,
  };

  if (!Array.isArray(bodyData)) return out;

  for (const item of bodyData) {
    const key = getParamKey(item);
    const role = getItemRole(key);
    const val = getCurrentValue(item);
    if (val === null) continue;

    switch (role) {
      case "weight":
        if (out.weight === null) out.weight = val;
        break;
      case "bodyFatPct":
        out.bfPct = val;
        break;
      case "fatMass":
        out.fatMass = val;
        break;
      case "ffm":
        out.ffm = val;
        break;
      case "muscleMass":
        out.muscleMass = out.muscleMass ?? val;
        break;
      case "ffmComponent":
        if (normalizeKey(key).includes("muscle"))
          out.muscleMass = out.muscleMass ?? val;
        break;
      case "visceral":
        out.visceral = val;
        break;
      default:
        break;
    }
  }

  // Derive missing FFM / fat mass / BF% from weight
  if (out.weight !== null) {
    if (out.fatMass !== null && out.ffm === null)
      out.ffm = out.weight - out.fatMass;
    if (out.ffm !== null && out.fatMass === null)
      out.fatMass = out.weight - out.ffm;
    if (out.bfPct !== null && out.fatMass === null)
      out.fatMass = (out.weight * out.bfPct) / 100;
    if (out.fatMass !== null && out.bfPct === null)
      out.bfPct = (out.fatMass / out.weight) * 100;
  }

  if (out.muscleMass === null && out.ffm !== null) {
    for (const item of bodyData) {
      const key = getParamKey(item);
      const k = normalizeKey(key);
      if (PARAM_KEY_PATTERNS.muscleMass.some((p) => k.includes(p))) {
        out.muscleMass = getCurrentValue(item);
        break;
      }
    }
  }

  return out;
}

/**
 * Classify user into bucket using structural indicators only (no raw BF% in rules).
 * sex: 1 = male, 2 = female
 */
function classify(metrics, sex) {
  const { weight, height, ffm, muscleMass, visceral } = metrics;
  if (weight == null || weight <= 0 || height == null || height <= 0)
    return "normal";

  const bmi = weight / (height * height);
  const ffmi = ffm != null && ffm > 0 ? ffm / (height * height) : null;
  const muscleToWeight =
    muscleMass != null && weight > 0 ? (muscleMass / weight) * 100 : null;
  const visceralNum = visceral != null ? Number(visceral) : null;

  const isFemale = sex === 2;

  if (isFemale) {
    // Female: use same structure with relaxed thresholds (spec said "needs separate definition")
    if (
      bmi < 26 &&
      ffmi >= 17.5 &&
      muscleToWeight >= 65 &&
      (visceralNum == null || visceralNum <= 11)
    )
      return "lean";
    if (
      bmi < 25 &&
      ffmi >= 17.0 &&
      muscleToWeight >= 68 &&
      (visceralNum == null || visceralNum <= 9)
    )
      return "athlete_very_lean";
    if (
      bmi >= 30 ||
      (visceralNum != null && visceralNum >= 12) ||
      (muscleToWeight != null && muscleToWeight < 60)
    )
      return "overweight";
    return "normal";
  }

  // Male classification (from spec). Bucket values match Supabase enum.
  if (
    bmi < 25 &&
    ffmi >= 18.5 &&
    muscleToWeight >= 70 &&
    (visceralNum == null || visceralNum <= 9)
  )
    return "athlete_very_lean";
  if (
    bmi < 26 &&
    ffmi >= 17.0 &&
    ffmi < 18.5 &&
    muscleToWeight >= 68 &&
    (visceralNum == null || visceralNum <= 11)
  )
    return "lean";
  if (
    bmi >= 30 ||
    (visceralNum != null && visceralNum >= 12) ||
    (muscleToWeight != null && muscleToWeight < 65)
  )
    return "overweight";
  if (
    bmi >= 20 &&
    bmi <= 29 &&
    (ffmi == null || ffmi < 17.5) &&
    (visceralNum == null || (visceralNum >= 8 && visceralNum <= 12))
  )
    return "normal";

  return "normal";
}

function clamp(val, min, max) {
  if (min != null && val < min) return min;
  if (max != null && val > max) return max;
  return val;
}

/**
 * Apply BIYO correction: classify, adjust BF%, rebalance masses, mutate a copy of body data.
 * @param {Array} bodyData - Raw lefuBodyData array
 * @param {number} heightCm - Height in cm
 * @param {number} weightKg - Weight in kg (source of truth)
 * @param {number} sex - 1 = male, 2 = female
 * @param {string} [userBodyType] - Optional profile user_body_type (e.g. for override)
 * @returns {{ mutatedBodyData: Array, bucket: string, bfCorrected: number | null, applied: boolean }}
 */
function applyCorrection(bodyData, heightCm, weightKg, sex, userBodyType) {
  const result = {
    mutatedBodyData: Array.isArray(bodyData)
      ? bodyData.map((item) => ({ ...item }))
      : [],
    bucket: "normal",
    bfCorrected: null,
    applied: false,
  };

  if (!Array.isArray(bodyData) || bodyData.length === 0) return result;

  const heightM =
    heightCm != null && Number.isFinite(Number(heightCm))
      ? Number(heightCm) / 100
      : null;
  const weight =
    weightKg != null && Number.isFinite(Number(weightKg))
      ? Number(weightKg)
      : null;

  const metrics = extractMetrics(bodyData, weightKg, heightCm);
  const bfRaw = metrics.bfPct;
  const fatMassOld = metrics.fatMass;
  const ffmOld = metrics.ffm;

  if (weight == null || weight <= 0 || (bfRaw == null && fatMassOld == null)) {
    return result;
  }

  const allowedBuckets = ["athlete_very_lean", "lean", "normal", "overweight"];
  const bucket =
    userBodyType &&
    allowedBuckets.includes(userBodyType.toLowerCase().replace(/\s/g, "_"))
      ? userBodyType.toLowerCase().replace(/\s/g, "_")
      : classify(metrics, sex);
  result.bucket = bucket;

  const adjustment = BF_ADJUSTMENT[bucket] ?? 0;
  const bounds = sex === 2 ? BF_BOUNDS.female : BF_BOUNDS.male;
  let bfCorrected =
    (bfRaw ?? (fatMassOld != null ? (fatMassOld / weight) * 100 : null)) +
    adjustment;
  bfCorrected = clamp(bfCorrected, bounds.min, bounds.max);
  result.bfCorrected = bfCorrected;

  const fatMassNew = weight * (bfCorrected / 100);
  const ffmNew = weight - fatMassNew;
  const ffmOldVal =
    ffmOld ?? weight - fatMassOld ?? weight - (weight * (bfRaw ?? 0)) / 100;
  if (ffmOldVal == null || ffmOldVal <= 0) return result;

  const k = ffmNew / ffmOldVal;
  result.applied = true;

  for (const item of result.mutatedBodyData) {
    const key = getParamKey(item);
    const role = getItemRole(key);
    const val = getCurrentValue(item);
    if (val === null) continue;

    switch (role) {
      case "weight":
        // unchanged
        break;
      case "bodyFatPct":
        setCurrentValue(item, bfCorrected);
        break;
      case "fatMass":
        setCurrentValue(item, fatMassNew);
        break;
      case "ffm":
        setCurrentValue(item, ffmNew);
        break;
      case "visceral":
        // leave as-is (level 1-60, not a mass)
        break;
      case "muscleMass":
      case "ffmComponent":
        setCurrentValue(item, val * k);
        break;
      default:
        break;
    }
  }

  return result;
}

module.exports = {
  extractMetrics,
  classify,
  applyCorrection,
  getParamKey,
  getCurrentValue,
  setCurrentValue,
  getItemRole,
};
