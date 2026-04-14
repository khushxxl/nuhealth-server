function normalizeActivity(data, calendarDate) {
  const metrics = [];
  const add = (key, name, val, unit) => {
    if (val != null) metrics.push({ category: "activity", metric_key: key, metric_name: name, value_num: val, value_text: null, unit });
  };
  add("steps", "Steps", data.steps, "steps");
  add("calories_total", "Total Calories", data.calories_total, "kcal");
  add("calories_active", "Active Calories", data.calories_active, "kcal");
  add("distance", "Distance", data.distance, "m");
  add("floors_climbed", "Floors Climbed", data.floors_climbed, "floors");
  add("exercise_time", "Exercise Time", data.active_seconds, "sec");
  add("stand_duration", "Stand Duration", data.stand_seconds, "sec");
  add("vo2_max", "VO2 Max", data.vo2_max, "mL/kg/min");

  // Mobility metrics (Apple Health specific)
  add("walking_speed", "Walking Speed", data.walking_speed, "m/s");
  add("walking_step_length", "Walking Step Length", data.walking_step_length, "m");
  add("walking_asymmetry", "Walking Asymmetry", data.walking_asymmetry, "%");
  add("walking_double_support", "Double Support Time", data.walking_double_support_percentage || data.double_support_percentage, "%");
  add("walking_steadiness", "Walking Steadiness", data.walking_steadiness, "%");
  return metrics;
}

function normalizeSleep(data, calendarDate) {
  const metrics = [];
  const add = (key, name, val, unit) => {
    if (val != null) metrics.push({ category: "sleep", metric_key: key, metric_name: name, value_num: val, value_text: null, unit });
  };
  const addText = (key, name, val, unit) => {
    if (val != null) metrics.push({ category: "sleep", metric_key: key, metric_name: name, value_num: null, value_text: String(val), unit });
  };
  // Junction uses "total" for stage-summed sleep, "duration" for total time tracked
  add("sleep_total", "Total Sleep", data.total || data.duration, "sec");
  add("sleep_rem", "REM Sleep", data.rem, "sec");
  add("sleep_deep", "Deep Sleep", data.deep, "sec");
  add("sleep_light", "Light Sleep", data.light, "sec");
  add("sleep_awake", "Awake Time", data.awake, "sec");
  add("sleep_efficiency", "Sleep Efficiency", data.efficiency, "%");
  add("time_in_bed", "Time in Bed", data.time_in_bed || data.duration, "sec");
  add("sleep_hr_avg", "Avg HR (Sleep)", data.hr_average, "bpm");
  add("sleep_hr_lowest", "Lowest HR (Sleep)", data.hr_lowest, "bpm");
  addText("bedtime_start", "Bedtime Start", data.bedtime_start, "");
  addText("bedtime_stop", "Bedtime End", data.bedtime_stop, "");
  return metrics;
}

function normalizeBody(data, calendarDate) {
  // Body composition is handled by Biyo Scale (scale_records). Skipped intentionally.
  return [];
}

function normalizeHeartRate(data, calendarDate) {
  const metrics = [];
  const add = (key, name, val, unit) => {
    if (val != null) metrics.push({ category: "physiology", metric_key: key, metric_name: name, value_num: val, value_text: null, unit });
  };
  add("hr_resting", "Resting Heart Rate", data.hr_resting, "bpm");
  add("hr_avg", "Avg Heart Rate", data.hr_average, "bpm");
  add("hrv", "Heart Rate Variability", data.hrv?.avg || data.hrv_average, "ms");
  add("spo2", "SpO2", data.spo2, "%");
  add("respiratory_rate", "Respiratory Rate", data.respiratory_rate, "brpm");
  return metrics;
}

function normalizeRecovery(data, calendarDate) {
  return [];
}

module.exports = { normalizeActivity, normalizeSleep, normalizeBody, normalizeHeartRate, normalizeRecovery };
