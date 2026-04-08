function normalizeActivity(data, calendarDate) {
  const metrics = [];
  const add = (key, name, val, unit) => {
    if (val != null) metrics.push({ category: "activity", metric_key: key, metric_name: name, value_num: val, value_text: null, unit });
  };
  add("strain_score", "Strain Score", data.strain, "");
  add("calories_total", "Total Calories", data.calories_total, "kcal");
  add("calories_active", "Active Calories", data.calories_active, "kcal");
  add("steps", "Steps", data.steps, "steps");
  add("distance", "Distance", data.distance, "m");
  add("active_duration", "Active Duration", data.active_seconds, "sec");
  return metrics;
}

function normalizeSleep(data, calendarDate) {
  const metrics = [];
  const add = (key, name, val, unit) => {
    if (val != null) metrics.push({ category: "sleep", metric_key: key, metric_name: name, value_num: val, value_text: null, unit });
  };
  add("sleep_total", "Total Sleep", data.total, "sec");
  add("sleep_rem", "REM Sleep", data.rem, "sec");
  add("sleep_deep", "Deep Sleep", data.deep, "sec");
  add("sleep_light", "Light Sleep", data.light, "sec");
  add("sleep_awake", "Awake Time", data.awake, "sec");
  add("sleep_efficiency", "Sleep Efficiency", data.efficiency, "%");
  add("sleep_latency", "Sleep Latency", data.latency, "sec");
  add("sleep_score", "Sleep Score", data.score, "");
  add("respiratory_rate", "Respiratory Rate", data.respiratory_rate, "brpm");
  add("sleep_hr_avg", "Avg HR (Sleep)", data.hr_average, "bpm");
  add("sleep_hrv_avg", "Avg HRV (Sleep)", data.hrv?.avg || data.hrv_average, "ms");
  return metrics;
}

function normalizeBody(data, calendarDate) {
  // Skip — body composition stays in scale_records
  return [];
}

function normalizeHeartRate(data, calendarDate) {
  const metrics = [];
  const add = (key, name, val, unit) => {
    if (val != null) metrics.push({ category: "physiology", metric_key: key, metric_name: name, value_num: val, value_text: null, unit });
  };
  add("hr_resting", "Resting Heart Rate", data.hr_resting, "bpm");
  add("hr_avg", "Avg Heart Rate", data.hr_average, "bpm");
  add("hr_max", "Max Heart Rate", data.hr_max, "bpm");
  add("hrv", "Heart Rate Variability", data.hrv?.avg || data.hrv_average, "ms");
  add("spo2", "SpO2", data.spo2, "%");
  return metrics;
}

// Whoop also sends recovery in activity data sometimes
function normalizeRecovery(data, calendarDate) {
  const metrics = [];
  const add = (key, name, val, unit) => {
    if (val != null) metrics.push({ category: "recovery", metric_key: key, metric_name: name, value_num: val, value_text: null, unit });
  };
  add("recovery_score", "Recovery Score", data.recovery_score, "%");
  add("hrv_balance", "HRV Balance", data.hrv_balance, "ms");
  add("rhr_contribution", "RHR Contribution", data.rhr_contribution, "");
  return metrics;
}

module.exports = { normalizeActivity, normalizeSleep, normalizeBody, normalizeHeartRate, normalizeRecovery };
