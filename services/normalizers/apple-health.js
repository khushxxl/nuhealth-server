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
  add("time_in_bed", "Time in Bed", data.time_in_bed, "sec");
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
