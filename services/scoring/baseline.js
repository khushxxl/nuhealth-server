/**
 * =============================================================================
 * BIYO SCORING — HISTORICAL BASELINE  (JS port of baseline.py)
 * =============================================================================
 * Per-user rolling baseline over 14- and 28-day windows, plus winsorise().
 *
 * history is an array of row objects: { date: "YYYY-MM-DD", <metric>: number }.
 * Cells that are missing (null/NaN in the source) are simply absent from the
 * row. A column that is entirely absent and a column present-but-all-missing
 * both yield the same empty baseline entry, exactly as pandas does.
 * =============================================================================
 */

const { FIELDS, BASELINE, BASELINE_METRICS } = require("./config");

const DAY_MS = 86400000;

function toUtcMidnightMs(d) {
  if (d instanceof Date) {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

// mean/sd/n over the last `days` days ending at `todayMs` (index >= today-days),
// matching baseline._window_stats. Population std (ddof=0); sd=0 when n==1.
function windowStats(values, dateMsList, days, todayMs) {
  const cutoff = todayMs - days * DAY_MS;
  const w = [];
  for (let i = 0; i < values.length; i++) {
    if (dateMsList[i] >= cutoff) w.push(values[i]);
  }
  if (w.length === 0) return { mean: null, sd: null, n: 0 };
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  let sd = 0.0;
  if (w.length > 1) {
    const variance = w.reduce((a, b) => a + (b - mean) * (b - mean), 0) / w.length;
    sd = Math.sqrt(variance);
  }
  return { mean, sd, n: w.length };
}

function buildBaseline(historyRows, today) {
  const rows = historyRows || [];
  const todayMs = toUtcMidnightMs(today || new Date());

  const out = {};
  for (const metric of BASELINE_METRICS) {
    const col = FIELDS[metric] || metric;
    const values = [];
    const dateMsList = [];
    for (const row of rows) {
      const v = row[col];
      if (v !== null && v !== undefined && typeof v === "number" && Number.isFinite(v)) {
        values.push(v);
        dateMsList.push(toUtcMidnightMs(row.date));
      }
    }
    const w14 = windowStats(values, dateMsList, BASELINE.trend_window_days, todayMs);
    const w28 = windowStats(values, dateMsList, BASELINE.hrv_baseline_days, todayMs);
    const nTotal = values.length;
    out[metric] = {
      mean_14d: w14.mean,
      sd_14d: w14.sd,
      n_14d: w14.n,
      mean_28d: w28.mean,
      sd_28d: w28.sd,
      n_28d: w28.n,
      n_total: nTotal,
      trend_ready: nTotal >= BASELINE.min_days_for_trend,
      hrv_ready: nTotal >= BASELINE.min_nights_for_hrv,
      sleep_ready: nTotal >= BASELINE.min_nights_for_sleep,
    };
  }
  return out;
}

// Cap a reading to ±outlier_sd_cap σ from the 28-day mean. Unchanged if no
// baseline yet (n_28d < 7) or value missing.
function winsorise(value, baselineEntry) {
  if (value === null || value === undefined) return null;
  const be = baselineEntry || {};
  const mean = be.mean_28d;
  const sd = be.sd_28d;
  const n = be.n_28d || 0;
  if (mean === null || mean === undefined || sd === null || sd === undefined || sd === 0 || n < 7) {
    return Number(value);
  }
  const cap = BASELINE.outlier_sd_cap * sd;
  return Math.min(Math.max(Number(value), mean - cap), mean + cap);
}

// Rolling-mean smoothing over the last `days` non-null daily scores (display-side
// helper; not used by the orchestrators).
function smoothScore(dailyScores, days) {
  const { DISPLAY_SMOOTHING_DAYS } = require("./config");
  const n = days || DISPLAY_SMOOTHING_DAYS;
  const clean = (dailyScores || []).filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  const window = clean.slice(Math.max(0, clean.length - n));
  if (window.length === 0) return null;
  return window.reduce((a, b) => a + b, 0) / window.length;
}

module.exports = { buildBaseline, winsorise, smoothScore, toUtcMidnightMs, DAY_MS };
