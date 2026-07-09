// PILLAR 4 (Lifestyle) — HABIT CONSISTENCY. % of last 90 days with any signal, floor 30.
const {
  FIELDS,
  ADHERENCE_CENTRE_PCT,
  ADHERENCE_SIGMA_PCT,
  ADHERENCE_FLOOR,
  LIFESTYLE_WINDOW_DAYS,
  LIFESTYLE_MIN_DAYS_FOR_TREND,
} = require("../config");
const { sigmoidScore, pyRound } = require("../utils");
const { toUtcMidnightMs, DAY_MS } = require("../baseline");

const SLEEP_FIELDS = ["sleep_score_0_100", "sleep_duration_min", "sleep_rhr_bpm"];
const SCALE_FIELDS = ["weight_kg", "fat_ratio_pct", "fat_mass_kg", "skeletal_muscle_mass_kg"];
const ACTIVITY_FIELDS = ["steps", "active_minutes"];

function _anyLogged(row, fieldNames) {
  for (const f of fieldNames) {
    const c = FIELDS[f] || f;
    const v = row[c];
    if (v != null && Number.isFinite(v)) return true;
  }
  return false;
}

function scoreHabitConsistency(historyRows, todayDate) {
  const rows = historyRows || [];
  if (!rows.length) return null;

  const todayMs = toUtcMidnightMs(todayDate || new Date());
  const cutoff = todayMs - LIFESTYLE_WINDOW_DAYS * DAY_MS;
  const window = rows.filter((r) => toUtcMidnightMs(r.date) >= cutoff);

  const daysInWindow = LIFESTYLE_WINDOW_DAYS;
  if (window.length < LIFESTYLE_MIN_DAYS_FOR_TREND) return null;

  let anyCatCount = 0;
  for (const r of window) {
    if (_anyLogged(r, SLEEP_FIELDS) || _anyLogged(r, SCALE_FIELDS) || _anyLogged(r, ACTIVITY_FIELDS)) {
      anyCatCount += 1;
    }
  }

  const overallPct = (anyCatCount / daysInWindow) * 100.0;
  const raw = sigmoidScore(overallPct, ADHERENCE_CENTRE_PCT, ADHERENCE_SIGMA_PCT, true);
  return pyRound(Math.max(raw, ADHERENCE_FLOOR), 2);
}

module.exports = { scoreHabitConsistency };
