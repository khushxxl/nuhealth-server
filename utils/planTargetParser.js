/**
 * Maps an action-plan goal + questionnaire answer to a tracked metric and a
 * single explicit numeric **target weight in kg**.
 *
 * The questionnaire now sends the user's chosen goal weight directly (in kg)
 * as a stringified number for `lw_1` / `gw_1`. Older / legacy answer formats
 * like "5-10 kg" or "Gain 10+ kg" are still parsed (delta from baseline) and
 * converted to an absolute target by the caller using the captured baseline.
 *
 * Returns null for goals without a measurable scale metric (improve_sleep,
 * improve_recovery, "Not sure yet"). In those cases the progress endpoint
 * falls back to time-based progress.
 */

const KEY_WEIGHT = "ppWeightKg";

/** Try to parse the answer as an absolute kg target (a plain number string). */
function parseAbsoluteKg(text) {
  if (text == null) return null;
  const str = typeof text === "number" ? String(text) : text;
  if (typeof str !== "string") return null;
  const trimmed = str.trim();
  // pure number
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const v = parseFloat(trimmed);
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  return null;
}

/**
 * Legacy: parse a delta range like "5-10 kg", "Gain 10+ kg", "20+ kg".
 * Returns the kg delta the user wants to move, or null.
 */
function parseKgRange(text) {
  if (!text || typeof text !== "string") return null;
  const cleaned = text.replace(/,/g, "").toLowerCase();

  const range = cleaned.match(/(\d+(?:\.\d+)?)\s*[-–to]+\s*(\d+(?:\.\d+)?)/);
  if (range) {
    const lo = parseFloat(range[1]);
    const hi = parseFloat(range[2]);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > 0) return (lo + hi) / 2;
  }

  const plus = cleaned.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (plus) {
    const v = parseFloat(plus[1]);
    if (Number.isFinite(v) && v > 0) return v;
  }

  const single = cleaned.match(/(\d+(?:\.\d+)?)\s*(kg|lb|pound)/);
  if (single) {
    const v = parseFloat(single[1]);
    if (Number.isFinite(v) && v > 0) return v;
  }

  return null;
}

/**
 * Return tracking config for a given goal + answers.
 *
 * Output shape (target-based, preferred):
 *   { trackedMetricKey, direction, targetKg }
 *
 * Or legacy delta-based for older answer formats:
 *   { trackedMetricKey, direction, deltaKg }
 *
 * Caller should prefer `targetKg` when present and fall back to applying
 * `deltaKg` to the captured baseline.
 */
function resolveTargetSpec(goal, answers) {
  if (!goal || !answers) return null;

  if (goal === "lose_weight" || goal === "gain_weight") {
    const key = goal === "lose_weight" ? "lw_1" : "gw_1";
    const direction = goal === "lose_weight" ? "decrease" : "increase";
    const raw = answers[key];

    // Preferred path: absolute target weight in kg
    const absolute = parseAbsoluteKg(raw);
    if (absolute != null) {
      return {
        trackedMetricKey: KEY_WEIGHT,
        direction,
        targetKg: absolute,
      };
    }

    // Legacy: parse range/delta and let caller compute target from baseline
    const delta = parseKgRange(raw);
    if (delta != null) {
      return {
        trackedMetricKey: KEY_WEIGHT,
        direction,
        deltaKg: delta,
      };
    }

    return null;
  }

  // improve_sleep / improve_recovery — no body-comp metric to track right now
  return null;
}

module.exports = { resolveTargetSpec, parseKgRange, parseAbsoluteKg };
