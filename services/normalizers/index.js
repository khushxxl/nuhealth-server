const whoop = require("./whoop");
const oura = require("./oura");
const appleHealth = require("./apple-health");
const eightSleep = require("./eight-sleep");

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

module.exports = { getNormalizer };
