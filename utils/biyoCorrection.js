/**
 * BIYO Body Fat Correction - classification, BF% adjustment, and FFM rebalancing.
 * Uses only structural indicators (no raw BF%) for classification; then corrects BF%
 * and scales all FFM-derived metrics so Fat_new + FFM_new = Weight.
 */

const {
  BF_ADJUSTMENT,
  BF_BOUNDS,
  MAX_DAILY_BF_CHANGE,
  BIYO_EXACT_KEYS,
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

/** Round to 2 decimal places to avoid saving long floats (e.g. 15.93000000000000). */
function roundTo2(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return num;
  return Math.round(num * 100) / 100;
}

function setCurrentValue(item, value) {
  const num = roundTo2(value);
  if ("currentValue" in item) item.currentValue = num;
  if ("current_value" in item) item.current_value = num;
  if (!("currentValue" in item) && !("current_value" in item))
    item.currentValue = num;
}

/** Determine the role of a body data item from its param key (exact match only). */
function getItemRole(paramKey) {
  const key = paramKey != null ? String(paramKey).trim() : "";
  if (!key) return null;
  if (BIYO_EXACT_KEYS.weight.includes(key)) return "weight";
  if (BIYO_EXACT_KEYS.fatMass.includes(key)) return "fatMass";
  if (BIYO_EXACT_KEYS.bodyFatPct.includes(key)) return "bodyFatPct";
  if (BIYO_EXACT_KEYS.ffm.includes(key)) return "ffm";
  if (BIYO_EXACT_KEYS.visceral.includes(key)) return "visceral";
  if (BIYO_EXACT_KEYS.muscleMass.includes(key)) return "muscleMass";
  if (BIYO_EXACT_KEYS.ffmComponent.includes(key)) return "ffmComponent";
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
      if (BIYO_EXACT_KEYS.muscleMass.includes(key)) {
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
    console.log("🔄 BIYO mutation: skipped (missing weight or BF/fatMass)");
    return result;
  }

  const allowedBuckets = ["athlete_very_lean", "lean", "normal", "overweight"];
  const normalized =
    userBodyType && String(userBodyType).trim()
      ? String(userBodyType).toLowerCase().replace(/\s/g, "_")
      : null;
  const bucket =
    normalized && allowedBuckets.includes(normalized) ? normalized : "normal";
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
  if (ffmOldVal == null || ffmOldVal <= 0) {
    console.log("🔄 BIYO mutation: skipped (invalid FFM_old)");
    return result;
  }

  const k = ffmNew / ffmOldVal;
  result.applied = true;

  // Mutation logs: raw → classification → adjustment → per-role counts
  const bfRawVal =
    bfRaw ?? (fatMassOld != null ? (fatMassOld / weight) * 100 : null);
  console.log("🔄 BIYO mutation: raw metrics", {
    weight_kg: weight,
    bf_pct_raw: bfRawVal != null ? bfRawVal.toFixed(2) : null,
    fat_mass_kg_raw: fatMassOld != null ? fatMassOld.toFixed(2) : null,
    ffm_kg_raw: ffmOldVal != null ? ffmOldVal.toFixed(2) : null,
    bucket,
    user_body_type_override: userBodyType ?? "(none)",
  });
  console.log("🔄 BIYO mutation: adjustment", {
    adjustment_pct: adjustment,
    bf_pct_corrected: bfCorrected.toFixed(2),
    fat_mass_kg_new: fatMassNew.toFixed(2),
    ffm_kg_new: ffmNew.toFixed(2),
    scaling_factor_k: Number(k.toFixed(4)),
  });

  const mutationCounts = { bodyFatPct: 0, fatMass: 0, ffm: 0, ffmComponent: 0 };

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
        mutationCounts.bodyFatPct++;
        break;
      case "fatMass":
        setCurrentValue(item, fatMassNew);
        mutationCounts.fatMass++;
        break;
      case "ffm":
        setCurrentValue(item, ffmNew);
        mutationCounts.ffm++;
        break;
      case "visceral":
        // leave as-is (level 1-60, not a mass)
        break;
      case "muscleMass":
      case "ffmComponent":
        setCurrentValue(item, val * k);
        mutationCounts.ffmComponent++;
        break;
      default:
        break;
    }
  }

  console.log("🔄 BIYO mutation: applied", mutationCounts);

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
