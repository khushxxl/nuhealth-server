// PILLAR 1 (Lifestyle) — COMPOSITE SIGNAL. 28-day mean of the other 5 scores.
const { LIFESTYLE_COMPOSITE_WINDOW } = require("../config");
const { pyRound } = require("../utils");
const { toUtcMidnightMs, DAY_MS } = require("../baseline");

const SCORE_COLUMNS = ["heart", "movement", "weight", "mind", "oxygen"];

function scoreCompositeSignal(scoresHistory, todayDate) {
  const rows = scoresHistory || [];
  if (!rows.length) return null;

  const todayMs = toUtcMidnightMs(todayDate || new Date());
  const cutoff = todayMs - LIFESTYLE_COMPOSITE_WINDOW * DAY_MS;
  const window = rows.filter((r) => toUtcMidnightMs(r.date) >= cutoff);
  if (!window.length) return null;

  const means = [];
  for (const col of SCORE_COLUMNS) {
    const vals = window.map((r) => r[col]).filter((v) => v != null && Number.isFinite(v));
    if (vals.length >= 7) means.push(vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  if (!means.length) return null;
  return pyRound(means.reduce((a, b) => a + b, 0) / means.length, 2);
}

module.exports = { scoreCompositeSignal };
