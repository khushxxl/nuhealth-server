function normalizeActivity(data, calendarDate) {
  return [];
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
  add("sleep_score", "Sleep Score", data.score, "");
  add("sleep_latency", "Sleep Latency", data.latency, "sec");
  add("toss_turns", "Toss & Turns", data.toss_and_turns, "");
  add("bed_temp", "Bed Temperature", data.temperature_bed || data.bed_temperature, "°C");
  add("room_temp", "Room Temperature", data.temperature_room || data.room_temperature, "°C");
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
  add("respiratory_rate", "Respiratory Rate", data.respiratory_rate, "brpm");
  return metrics;
}

function normalizeRecovery(data, calendarDate) {
  const metrics = [];
  const add = (key, name, val, unit) => {
    if (val != null) metrics.push({ category: "recovery", metric_key: key, metric_name: name, value_num: val, value_text: null, unit });
  };
  add("sleep_fitness_score", "Sleep Fitness Score", data.sleep_fitness_score, "");
  return metrics;
}

module.exports = { normalizeActivity, normalizeSleep, normalizeBody, normalizeHeartRate, normalizeRecovery };
