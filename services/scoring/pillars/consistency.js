// PILLAR 4 (Weight) — CONSISTENCY. Unique weigh-in days in last 14: 2→0, 8→100.
const {
  FIELDS,
  CONSISTENCY_DAYS_WINDOW,
  CONSISTENCY_FULL_DAYS,
  CONSISTENCY_MIN_DAYS,
} = require("../config");
const { pyRound } = require("../utils");
const { toUtcMidnightMs, DAY_MS } = require("../baseline");

function _finite(v) {
  return v != null && typeof v === "number" && Number.isFinite(v);
}

function scoreConsistency(historyRows, todayDate) {
  const rows = historyRows || [];
  if (!rows.length) return 0.0;
  const todayMs = toUtcMidnightMs(todayDate || new Date());

  let col = FIELDS.fat_ratio_pct || "fat_ratio_pct";
  if (!rows.some((r) => _finite(r[col]))) {
    // Fall back to any column with at least one non-null value.
    const keys = [];
    for (const r of rows) for (const k of Object.keys(r)) if (k !== "date" && !keys.includes(k)) keys.push(k);
    let found = null;
    for (const k of keys) {
      if (rows.some((r) => _finite(r[k]))) {
        found = k;
        break;
      }
    }
    if (found == null) return 0.0;
    col = found;
  }

  const cutoff = todayMs - CONSISTENCY_DAYS_WINDOW * DAY_MS;
  const days = new Set();
  for (const r of rows) {
    if (_finite(r[col])) {
      const ms = toUtcMidnightMs(r.date);
      if (ms >= cutoff) days.add(ms);
    }
  }
  const nDays = days.size;

  if (nDays <= CONSISTENCY_MIN_DAYS) return 0.0;
  if (nDays >= CONSISTENCY_FULL_DAYS) return 100.0;
  const span = CONSISTENCY_FULL_DAYS - CONSISTENCY_MIN_DAYS;
  return pyRound(((nDays - CONSISTENCY_MIN_DAYS) / span) * 100.0, 2);
}

module.exports = { scoreConsistency };
