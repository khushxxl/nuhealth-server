const whoop = require("./whoop");
const oura = require("./oura");
const appleHealth = require("./apple-health");
const eightSleep = require("./eight-sleep");

/**
 * Extract physiology metrics from the `heart_rate` sub-object that Junction
 * embeds inside `daily.data.activity` events. Shared across all providers
 * since the shape is consistent.
 *
 * Shape: { avg_bpm, avg_walking_bpm, max_bpm, min_bpm, resting_bpm }
 */
function extractEmbeddedHeartRate(data) {
  const hr = data && data.heart_rate;
  if (!hr || typeof hr !== "object") return [];
  const metrics = [];
  const add = (key, name, val, unit) => {
    if (val != null)
      metrics.push({
        category: "physiology",
        metric_key: key,
        metric_name: name,
        value_num: val,
        value_text: null,
        unit,
      });
  };
  add("hr_resting", "Resting Heart Rate", hr.resting_bpm, "bpm");
  add("hr_avg", "Avg Heart Rate", hr.avg_bpm, "bpm");
  add("hr_max", "Max Heart Rate", hr.max_bpm, "bpm");
  return metrics;
}

const normalizers = {
  whoop,
  oura,
  apple_health_kit: appleHealth,
  apple_health: appleHealth,
  eight_sleep: eightSleep,
  "8sleep": eightSleep,
};

/**
 * Get the normalizer for a given Junction provider slug.
 * @param {string} provider - e.g. "whoop", "oura", "apple_health_kit", "eight_sleep"
 * @returns {{ normalizeActivity, normalizeSleep, normalizeBody, normalizeHeartRate } | null}
 */
function getNormalizer(provider) {
  return normalizers[provider] || null;
}

module.exports = { getNormalizer, extractEmbeddedHeartRate };
