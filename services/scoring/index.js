/**
 * =============================================================================
 * BIYO SCORING — public entry point (JS port of the Python biyo_scoring package)
 * =============================================================================
 * Pure functions, no Python at runtime. Each score takes:
 *   today        — flat object, one merged reading (field names per config.FIELDS)
 *   historyRows  — array of { date: "YYYY-MM-DD", <metric>: number }, one per day
 *   profile      — { age_years, sex, height_cm, weight_kg, body_type }
 *   todayDate    — "YYYY-MM-DD" | Date (optional; defaults to now)
 * Lifestyle also takes scoresHistory — array of { date, heart, movement, weight,
 * mind, oxygen } daily /100 scores you persist and feed back.
 *
 * Each returns the same JSON-serialisable shape as the Python engine.
 * =============================================================================
 */

const { scoreHeartCirculation } = require("./scores/heart_circulation");
const { scoreMovementQuality } = require("./scores/movement_quality");
const { scoreWeightManagement } = require("./scores/weight_management");
const { scoreMindFocus } = require("./scores/mind_focus");
const { scoreOxygenBreathing } = require("./scores/oxygen_breathing");
const { scoreLifestyleIndex } = require("./scores/lifestyle_index");

function scoreAll(today, historyRows, profile, scoresHistory, todayDate) {
  return {
    heart: scoreHeartCirculation(today, historyRows, profile, todayDate),
    movement: scoreMovementQuality(today, historyRows, profile, todayDate),
    weight: scoreWeightManagement(today, historyRows, profile, todayDate),
    mind: scoreMindFocus(today, historyRows, profile, todayDate),
    oxygen: scoreOxygenBreathing(today, historyRows, profile, todayDate),
    lifestyle: scoreLifestyleIndex(today, historyRows, profile, scoresHistory, todayDate),
  };
}

module.exports = {
  scoreHeartCirculation,
  scoreMovementQuality,
  scoreWeightManagement,
  scoreMindFocus,
  scoreOxygenBreathing,
  scoreLifestyleIndex,
  scoreAll,
};
