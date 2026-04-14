function normalizeActivity(data, calendarDate) {
  const metrics = [];
  const add = (key, name, val, unit) => {
    if (val != null) metrics.push({ category: "activity", metric_key: key, metric_name: name, value_num: val, value_text: null, unit });
  };
  add("activity_score", "Activity Score", data.score, "");
  add("steps", "Steps", data.steps, "steps");
  add("calories_total", "Total Calories", data.calories_total, "kcal");
  add("calories_active", "Active Calories", data.calories_active, "kcal");
  add("distance", "Distance", data.distance, "m");
  add("sedentary_time", "Sedentary Time", data.sedentary_seconds, "sec");
  add("active_duration", "Active Duration", data.active_seconds, "sec");
  return metrics;
}

function normalizeSleep(data, calendarDate) {
  const metrics = [];
  const add = (key, name, val, unit) => {
    if (val != null) metrics.push({ category: "sleep", metric_key: key, metric_name: name, value_num: val, value_text: null, unit });
  };
  add("sleep_total", "Total Sleep", data.total || data.duration, "sec");
  add("sleep_rem", "REM Sleep", data.rem, "sec");
  add("sleep_deep", "Deep Sleep", data.deep, "sec");
  add("sleep_light", "Light Sleep", data.light, "sec");
  add("sleep_awake", "Awake Time", data.awake, "sec");
  add("sleep_efficiency", "Sleep Efficiency", data.efficiency, "%");
  add("sleep_latency", "Sleep Latency", data.latency, "sec");
  add("sleep_score", "Sleep Score", data.score, "");
  add("sleep_hr_lowest", "Lowest HR (Sleep)", data.hr_lowest, "bpm");
  add("sleep_hrv_avg", "Avg HRV (Sleep)", data.hrv?.avg || data.hrv_average, "ms");
  add("respiratory_rate", "Respiratory Rate", data.respiratory_rate, "brpm");
  add("sleep_restlessness", "Restlessness", data.restless_periods, "");
  return metrics;
}

function normalizeBody(data, calendarDate) {
  return [];
}

function normalizeHeartRate(data, calendarDate) {
  const metrics = [];
  const add = (key, name, val, unit) => {
    if (val != null) metrics.push({ category: "physiology", metric_key: key, metric_name: name, value_num: val, value_text: null, unit });
  };
  add("hr_resting", "Resting Heart Rate", data.hr_resting, "bpm");
  add("hrv", "Heart Rate Variability", data.hrv?.avg || data.hrv_average, "ms");
  add("body_temp_deviation", "Temp Deviation", data.temperature_deviation || data.temperature_delta, "°C");
  add("respiratory_rate", "Respiratory Rate", data.respiratory_rate, "brpm");
  return metrics;
}

function normalizeRecovery(data, calendarDate) {
  const metrics = [];
  const add = (key, name, val, unit) => {
    if (val != null) metrics.push({ category: "recovery", metric_key: key, metric_name: name, value_num: val, value_text: null, unit });
  };
  add("readiness_score", "Readiness Score", data.readiness_score || data.score, "");
  add("activity_balance", "Activity Balance", data.activity_balance, "");
  add("sleep_balance", "Sleep Balance", data.sleep_balance, "");
  add("recovery_index", "Recovery Index", data.recovery_index, "");
  return metrics;
}

module.exports = { normalizeActivity, normalizeSleep, normalizeBody, normalizeHeartRate, normalizeRecovery };
