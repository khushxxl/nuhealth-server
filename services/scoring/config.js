/**
 * =============================================================================
 * BIYO SCORING — CENTRAL CONFIG  (JS port of config.py)
 * =============================================================================
 * Single source of truth for field names, reference centres/SDs, baseline
 * windows and confidence-flag thresholds. Constants only — no logic here.
 *
 * Values transcribed verbatim from biyo_scoring/config.py. Rename only the
 * RIGHT-hand side of FIELDS to match your Supabase columns.
 * =============================================================================
 */

// --- 1. DB / JSON field names -----------------------------------------------
const FIELDS = {
  // user profile
  age_years: "age_years",
  sex: "sex",
  height_cm: "height_cm",
  weight_kg: "weight_kg",
  body_type: "body_type",

  // scale
  visceral_fat: "visceral_fat",
  trunk_fat_ratio_pct: "trunk_fat_ratio_pct",
  fat_ratio_pct: "fat_ratio_pct",
  fat_mass_kg: "fat_mass_kg",
  muscle_rate_pct: "muscle_rate_pct",
  skeletal_muscle_mass_kg: "skeletal_muscle_mass_kg",
  recommended_calorie_intake: "recommended_calorie_intake",
  body_age_years: "body_age_years",
  scale_taken_at: "scale_taken_at",

  // wearable — RHR & HRV
  resting_heart_rate_bpm: "resting_heart_rate_bpm",
  hrv_rmssd_ms: "hrv_rmssd_ms",
  hrv_sdnn_ms: "hrv_sdnn_ms",

  // wearable — aerobic
  vo2_max_ml_kg_min: "vo2_max_ml_kg_min",
  hr_recovery_1min_bpm: "hr_recovery_1min_bpm",
  workout_time_zones_4_5_sec: "workout_time_zones_4_5_sec",
  daily_activity_score_0_100: "daily_activity_score_0_100",

  // wearable — daily movement
  steps: "steps",
  active_minutes: "active_minutes",
  met_minutes: "met_minutes",

  // scale — segmental muscle (Movement Quality)
  left_arm_muscle_mass_kg: "left_arm_muscle_mass_kg",
  right_arm_muscle_mass_kg: "right_arm_muscle_mass_kg",
  left_leg_muscle_mass_kg: "left_leg_muscle_mass_kg",
  right_leg_muscle_mass_kg: "right_leg_muscle_mass_kg",
  trunk_muscle_mass_kg: "trunk_muscle_mass_kg",
  muscle_quality_index: "muscle_quality_index",

  // wearable — sleep
  sleep_duration_min: "sleep_duration_min",
  sleep_efficiency_pct: "sleep_efficiency_pct",
  deep_sleep_min: "deep_sleep_min",
  rem_sleep_min: "rem_sleep_min",
  sleep_score_0_100: "sleep_score_0_100",
  sleep_rhr_bpm: "sleep_rhr_bpm",

  // wearable — readiness / recovery / mind
  readiness_score_0_100: "readiness_score_0_100",
  recovery_score_0_100: "recovery_score_0_100",
  respiratory_rate_brpm: "respiratory_rate_brpm",
  mindfulness_minutes: "mindfulness_minutes",
  activity_balance_0_100: "activity_balance_0_100",

  // wearable — oxygen & breathing
  spo2_pct: "spo2_pct",
  workout_high_hr_minutes: "workout_high_hr_minutes",

  // provenance
  wearable_source: "wearable_source",
  reading_date: "reading_date",
};

// --- 2. Source-priority order -----------------------------------------------
const RHR_PRIORITY = ["oura", "whoop", "8sleep", "apple_health"];
const HRV_RMSSD_PRIORITY = ["oura", "whoop", "8sleep"];
const SLEEP_PRIORITY = ["oura", "8sleep", "whoop", "apple_health"];

// --- 3. Baseline windows ----------------------------------------------------
const BASELINE = {
  trend_window_days: 14,
  hrv_baseline_days: 28,
  min_days_for_trend: 7,
  min_nights_for_hrv: 14,
  min_nights_for_sleep: 7,
  outlier_sd_cap: 3.0,
};

// --- 4. Population reference centres -----------------------------------------
const RHR_REFERENCE = {
  male: { "18-29": 65, "30-39": 66, "40-49": 68, "50-59": 70, "60-69": 71, "70+": 72 },
  female: { "18-29": 70, "30-39": 71, "40-49": 72, "50-59": 73, "60-69": 74, "70+": 75 },
};
const RHR_SIGMA_BPM = 8.0;

const VO2MAX_REFERENCE = {
  male: { "18-29": 43.9, "30-39": 42.4, "40-49": 39.2, "50-59": 35.5, "60-69": 32.3, "70+": 29.4 },
  female: { "18-29": 36.1, "30-39": 34.4, "40-49": 33.0, "50-59": 30.1, "60-69": 27.5, "70+": 25.1 },
};
const VO2MAX_SIGMA = 7.0;

const VISCERAL_FAT_CENTRE = 9.0;
const VISCERAL_FAT_SIGMA = 3.0;

const TRUNK_FAT_REFERENCE = { male: 22.0, female: 32.0 };
const TRUNK_FAT_SIGMA = 6.0;

const SLEEP_DURATION_CENTRE_MIN = 450.0;
const SLEEP_DURATION_SIGMA_MIN = 60.0;

const SLEEP_EFFICIENCY_CENTRE_PCT = 87.0;
const SLEEP_EFFICIENCY_SIGMA_PCT = 6.0;

// --- 5. Heart & Circulation pillar weights ----------------------------------
const HEART_PILLAR_WEIGHTS = {
  resting_load: 0.25,
  autonomic: 0.2,
  aerobic: 0.2,
  central_load: 0.2,
  sleep: 0.15,
};

// --- 5b. Movement Quality pillar weights ------------------------------------
const MOVEMENT_PILLAR_WEIGHTS = {
  muscle_foundation: 0.3,
  limb_symmetry: 0.2,
  lower_body_reserve: 0.2,
  daily_movement: 0.2,
  recovery_headroom: 0.1,
};

// --- 5c. Movement reference values ------------------------------------------
const SMMI_REFERENCE = { male: 10.75, female: 8.0 };
const SMMI_SIGMA = 1.2;

const LEG_SMMI_REFERENCE = { male: 4.2, female: 3.3 };
const LEG_SMMI_SIGMA = 0.6;

const SYMMETRY_CENTRE_PCT = 5.0;
const SYMMETRY_SIGMA_PCT = 3.0;

const STEPS_CENTRE = 8000;
const STEPS_SIGMA = 3000;

const ACTIVE_MIN_CENTRE = 30;
const ACTIVE_MIN_SIGMA = 15;

const MQI_NEUTRAL = 90.0;
const MQI_SPREAD = 20.0;

// --- 5g. Long-term Lifestyle Index pillar weights ---------------------------
const LIFESTYLE_PILLAR_WEIGHTS = {
  composite_signal: 0.4,
  body_age_trend: 0.2,
  weight_stability: 0.15,
  habit_consistency: 0.15,
  activity_habit: 0.1,
};

const LIFESTYLE_WINDOW_DAYS = 90;
const LIFESTYLE_MIN_DAYS_FOR_TREND = 28;
const LIFESTYLE_COMPOSITE_WINDOW = 28;

const BODY_AGE_DELTA_SIGMA_YEARS = 4.0;

const WEIGHT_CV_CENTRE_PCT = 1.5;
const WEIGHT_CV_SIGMA_PCT = 1.0;

const ADHERENCE_CENTRE_PCT = 65.0;
const ADHERENCE_SIGMA_PCT = 15.0;
const ADHERENCE_FLOOR = 30.0;

const LT_STEPS_CENTRE = 7000;
const LT_STEPS_SIGMA = 2500;
const ACTIVITY_HABIT_FLOOR = 30.0;

// --- 5f. Oxygen & Breathing pillar weights ----------------------------------
const OXYGEN_PILLAR_WEIGHTS = {
  respiratory_stability: 0.3,
  aerobic_capacity: 0.25,
  spo2_stability: 0.2,
  sleep_oxygenation: 0.15,
  breathing_capacity: 0.1,
};

const RESP_RATE_SIGMA_BRPM = 1.5;

const SPO2_SIGMA_PCT = 1.0;
const SPO2_FLOOR_SCORE = 25.0;

const HIGH_HR_MIN_CENTRE = 8.0;
const HIGH_HR_MIN_SIGMA = 5.0;
const HIGH_HR_FLOOR = 35.0;

// --- 5e. Mind & Focus pillar weights ----------------------------------------
const MIND_PILLAR_WEIGHTS = {
  hrv_stability: 0.3,
  recovery_readiness: 0.25,
  sleep_quality: 0.2,
  stress_signature: 0.15,
  mindful_engagement: 0.1,
};

const READINESS_FLOOR_SCORE = 30.0;

const REM_DEEP_RATIO_CENTRE = 0.4;
const REM_DEEP_RATIO_SIGMA = 0.1;

const STRESS_RHR_SIGMA = 4.0;

const MINDFUL_MIN_CENTRE = 10;
const MINDFUL_MIN_SIGMA = 6;
const MINDFUL_FLOOR_SCORE = 50.0;

const HRV_STABILITY_RMSSD_SIGMA_MS = 12.0;
const HRV_STABILITY_SDNN_SIGMA_MS = 18.0;

// --- 5d. Weight Management pillar weights ------------------------------------
const WEIGHT_PILLAR_WEIGHTS = {
  composition_balance: 0.3,
  trend_quality: 0.3,
  central_fat_trend: 0.2,
  consistency: 0.1,
  energy_balance: 0.1,
};

const BODY_FAT_CENTRE = { male: 18.0, female: 25.0 };
const BODY_FAT_SIGMA = 7.0;

const UNDER_FAT_FLOOR = { male: 12.0, female: 18.0 };
const UNDER_FAT_PENALTY = 30.0;

const P1_TREND_WEIGHT = 0.6;
const P1_ABSOLUTE_WEIGHT = 0.4;

const TREND_FAT_SIGMA_KG = 1.0;
const TREND_MUSCLE_SIGMA_KG = 0.5;

const CONSISTENCY_DAYS_WINDOW = 14;
const CONSISTENCY_FULL_DAYS = 8;
const CONSISTENCY_MIN_DAYS = 2;

// --- 6. Output smoothing ----------------------------------------------------
const DISPLAY_SMOOTHING_DAYS = 7;

// --- 7. Compliance display strings ------------------------------------------
const DISCLAIMER =
  "Biyo metrics are wellness indicators, not medical diagnostics. " +
  "Always consult a medical professional for health concerns.";

// Metrics that get a rolling baseline (from baseline.py BASELINE_METRICS).
const BASELINE_METRICS = [
  "resting_heart_rate_bpm",
  "hrv_rmssd_ms",
  "hrv_sdnn_ms",
  "vo2_max_ml_kg_min",
  "hr_recovery_1min_bpm",
  "visceral_fat",
  "trunk_fat_ratio_pct",
  "fat_mass_kg",
  "fat_ratio_pct",
  "muscle_rate_pct",
  "skeletal_muscle_mass_kg",
  "weight_kg",
  "sleep_duration_min",
  "sleep_efficiency_pct",
  "sleep_score_0_100",
  "deep_sleep_min",
  "rem_sleep_min",
  "steps",
  "active_minutes",
  "sleep_rhr_bpm",
  "readiness_score_0_100",
  "recovery_score_0_100",
  "respiratory_rate_brpm",
  "mindfulness_minutes",
  "activity_balance_0_100",
  "spo2_pct",
  "workout_high_hr_minutes",
  "body_age_years",
];

module.exports = {
  FIELDS,
  RHR_PRIORITY,
  HRV_RMSSD_PRIORITY,
  SLEEP_PRIORITY,
  BASELINE,
  RHR_REFERENCE,
  RHR_SIGMA_BPM,
  VO2MAX_REFERENCE,
  VO2MAX_SIGMA,
  VISCERAL_FAT_CENTRE,
  VISCERAL_FAT_SIGMA,
  TRUNK_FAT_REFERENCE,
  TRUNK_FAT_SIGMA,
  SLEEP_DURATION_CENTRE_MIN,
  SLEEP_DURATION_SIGMA_MIN,
  SLEEP_EFFICIENCY_CENTRE_PCT,
  SLEEP_EFFICIENCY_SIGMA_PCT,
  HEART_PILLAR_WEIGHTS,
  MOVEMENT_PILLAR_WEIGHTS,
  SMMI_REFERENCE,
  SMMI_SIGMA,
  LEG_SMMI_REFERENCE,
  LEG_SMMI_SIGMA,
  SYMMETRY_CENTRE_PCT,
  SYMMETRY_SIGMA_PCT,
  STEPS_CENTRE,
  STEPS_SIGMA,
  ACTIVE_MIN_CENTRE,
  ACTIVE_MIN_SIGMA,
  MQI_NEUTRAL,
  MQI_SPREAD,
  LIFESTYLE_PILLAR_WEIGHTS,
  LIFESTYLE_WINDOW_DAYS,
  LIFESTYLE_MIN_DAYS_FOR_TREND,
  LIFESTYLE_COMPOSITE_WINDOW,
  BODY_AGE_DELTA_SIGMA_YEARS,
  WEIGHT_CV_CENTRE_PCT,
  WEIGHT_CV_SIGMA_PCT,
  ADHERENCE_CENTRE_PCT,
  ADHERENCE_SIGMA_PCT,
  ADHERENCE_FLOOR,
  LT_STEPS_CENTRE,
  LT_STEPS_SIGMA,
  ACTIVITY_HABIT_FLOOR,
  OXYGEN_PILLAR_WEIGHTS,
  RESP_RATE_SIGMA_BRPM,
  SPO2_SIGMA_PCT,
  SPO2_FLOOR_SCORE,
  HIGH_HR_MIN_CENTRE,
  HIGH_HR_MIN_SIGMA,
  HIGH_HR_FLOOR,
  MIND_PILLAR_WEIGHTS,
  READINESS_FLOOR_SCORE,
  REM_DEEP_RATIO_CENTRE,
  REM_DEEP_RATIO_SIGMA,
  STRESS_RHR_SIGMA,
  MINDFUL_MIN_CENTRE,
  MINDFUL_MIN_SIGMA,
  MINDFUL_FLOOR_SCORE,
  HRV_STABILITY_RMSSD_SIGMA_MS,
  HRV_STABILITY_SDNN_SIGMA_MS,
  WEIGHT_PILLAR_WEIGHTS,
  BODY_FAT_CENTRE,
  BODY_FAT_SIGMA,
  UNDER_FAT_FLOOR,
  UNDER_FAT_PENALTY,
  P1_TREND_WEIGHT,
  P1_ABSOLUTE_WEIGHT,
  TREND_FAT_SIGMA_KG,
  TREND_MUSCLE_SIGMA_KG,
  CONSISTENCY_DAYS_WINDOW,
  CONSISTENCY_FULL_DAYS,
  CONSISTENCY_MIN_DAYS,
  DISPLAY_SMOOTHING_DAYS,
  DISCLAIMER,
  BASELINE_METRICS,
};
