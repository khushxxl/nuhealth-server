// PILLAR 5 (Lifestyle) — ACTIVITY HABIT. 90-day avg steps 60% + active-min 40%, floor 30.
const {
  FIELDS,
  LT_STEPS_CENTRE,
  LT_STEPS_SIGMA,
  ACTIVE_MIN_CENTRE,
  ACTIVE_MIN_SIGMA,
  ACTIVITY_HABIT_FLOOR,
  LIFESTYLE_WINDOW_DAYS,
  LIFESTYLE_MIN_DAYS_FOR_TREND,
} = require("../config");
const { sigmoidScore, pyRound } = require("../utils");
const { toUtcMidnightMs, DAY_MS } = require("../baseline");

function scoreActivityHabit(historyRows, todayDate) {
  const rows = historyRows || [];
  if (!rows.length) return null;

  const todayMs = toUtcMidnightMs(todayDate || new Date());
  const cutoff = todayMs - LIFESTYLE_WINDOW_DAYS * DAY_MS;
  const window = rows.filter((r) => toUtcMidnightMs(r.date) >= cutoff);
  if (window.length < LIFESTYLE_MIN_DAYS_FOR_TREND) return null;

  const parts = [];

  const stepsCol = FIELDS.steps || "steps";
  const stepsVals = window.map((r) => r[stepsCol]).filter((v) => v != null && Number.isFinite(v));
  if (stepsVals.length >= 14) {
    const m = stepsVals.reduce((a, b) => a + b, 0) / stepsVals.length;
    parts.push([sigmoidScore(m, LT_STEPS_CENTRE, LT_STEPS_SIGMA, true), 0.6]);
  }

  const amCol = FIELDS.active_minutes || "active_minutes";
  const amVals = window.map((r) => r[amCol]).filter((v) => v != null && Number.isFinite(v));
  if (amVals.length >= 14) {
    const m = amVals.reduce((a, b) => a + b, 0) / amVals.length;
    parts.push([sigmoidScore(m, ACTIVE_MIN_CENTRE, ACTIVE_MIN_SIGMA, true), 0.4]);
  }

  if (!parts.length) return null;
  const totalW = parts.reduce((a, [, w]) => a + w, 0);
  const raw = parts.reduce((a, [s, w]) => a + s * w, 0) / totalW;
  return pyRound(Math.max(raw, ACTIVITY_HABIT_FLOOR), 2);
}

module.exports = { scoreActivityHabit };
