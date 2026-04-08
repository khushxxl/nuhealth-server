const { getServiceClient } = require("./supabase");

// ─── Source priority per metric (1 = highest priority) ───
// Based on the Metric Data Source Priority List.
// Lower number = preferred source. Missing source = not supported for that metric.
const SOURCE_PRIORITY = {
  // Physiology
  hr_resting:           { biyo_scale: 5, whoop: 1, oura: 3, apple_health: 2, "8sleep": 4 },
  hrv:                  { whoop: 1, oura: 3, apple_health: 2, "8sleep": 4 },
  respiratory_rate:     { whoop: 2, oura: 4, apple_health: 3, "8sleep": 1 },
  spo2:                 { whoop: 2, apple_health: 1 },
  body_temp_deviation:  { whoop: 1, oura: 3, apple_health: 2 },

  // Sleep
  sleep_total:          { whoop: 2, oura: 4, apple_health: 3, "8sleep": 1 },
  time_in_bed:          { whoop: 2, oura: 4, apple_health: 3, "8sleep": 1 },
  sleep_awake:          { whoop: 2, oura: 4, apple_health: 3, "8sleep": 1 },
  sleep_light:          { whoop: 2, oura: 4, apple_health: 3, "8sleep": 1 },
  sleep_deep:           { whoop: 2, oura: 4, apple_health: 3, "8sleep": 1 },
  sleep_rem:            { whoop: 2, oura: 4, apple_health: 3, "8sleep": 1 },
  sleep_efficiency:     { whoop: 2, oura: 4, "8sleep": 1 },
  sleep_latency:        { whoop: 2, oura: 4, "8sleep": 1 },
  sleep_score:          { whoop: 2, oura: 4, "8sleep": 1 },
  sleep_hr_avg:         { whoop: 2, oura: 4, "8sleep": 1 },
  sleep_hrv_avg:        { whoop: 2, oura: 4, "8sleep": 1 },

  // Recovery
  recovery_score:       { whoop: 1, oura: 2 },
  readiness_score:      { whoop: 1, oura: 2 },

  // Activity
  calories_total:       { whoop: 1, oura: 3, apple_health: 2 },
  calories_active:      { whoop: 1, oura: 3, apple_health: 2 },
};

// Metrics where we take the highest value instead of priority-based selection
const USE_MAX_VALUE = new Set(["steps"]);

/**
 * Given multiple rows for the same metric_key, pick the best one
 * based on the priority table. Falls back to most recent if no priority defined.
 */
function pickBestRow(rows) {
  if (rows.length === 1) return rows[0];

  const key = rows[0].metric_key;

  // Special rule: steps → take the highest value
  if (USE_MAX_VALUE.has(key)) {
    return rows.reduce((best, row) =>
      (row.value_num || 0) > (best.value_num || 0) ? row : best
    );
  }

  const priorities = SOURCE_PRIORITY[key];
  if (!priorities) {
    // No priority defined → use most recent
    return rows[0]; // Already sorted by recorded_at DESC
  }

  return rows.reduce((best, row) => {
    const bestP = priorities[best.source] || 99;
    const rowP = priorities[row.source] || 99;
    return rowP < bestP ? row : best;
  });
}

/**
 * Persist an array of normalized metrics to the health_metrics table.
 * Uses upsert with the dedup index to handle webhook retries gracefully.
 *
 * @param {string} userId - Supabase user ID
 * @param {string} source - Provider slug: whoop, oura, apple_health, 8sleep
 * @param {string} recordedAt - ISO timestamp of the measurement
 * @param {Array<{category, metric_key, metric_name, value_num, value_text, unit}>} metrics
 * @returns {Promise<{saved: number, skipped: number}>}
 */
async function saveMetrics(userId, source, recordedAt, metrics) {
  if (!metrics || metrics.length === 0) return { saved: 0, skipped: 0 };

  const supabase = getServiceClient();
  const rows = metrics.map((m) => ({
    user_id: userId,
    source,
    category: m.category,
    metric_key: m.metric_key,
    metric_name: m.metric_name,
    value_num: m.value_num != null ? Math.round(m.value_num * 100) / 100 : null,
    value_text: m.value_text || null,
    unit: m.unit || "",
    recorded_at: recordedAt,
  }));

  const { data, error: dbError } = await supabase
    .from("health_metrics")
    .upsert(rows, { onConflict: "user_id,source,metric_key,recorded_at", ignoreDuplicates: true })
    .select("id");

  if (dbError) {
    console.error("❌ health_metrics upsert error:", dbError.message);
    throw dbError;
  }

  const saved = data?.length || 0;
  return { saved, skipped: rows.length - saved };
}

/**
 * Get the latest metrics for a user, optionally filtered by category or source.
 */
async function getLatest(userId, { category, source, limit = 50 } = {}) {
  const supabase = getServiceClient();
  let query = supabase
    .from("health_metrics")
    .select("*")
    .eq("user_id", userId)
    .order("recorded_at", { ascending: false })
    .limit(limit);

  if (category) query = query.eq("category", category);
  if (source) query = query.eq("source", source);

  const { data, error: dbError } = await query;
  if (dbError) throw dbError;
  return data || [];
}

/**
 * Get the most recent value for each unique metric_key in a category.
 * When multiple sources provide the same metric, picks the best source
 * based on the priority table (or highest value for steps).
 */
async function getLatestByCategory(userId, category) {
  const supabase = getServiceClient();

  const { data, error: dbError } = await supabase
    .from("health_metrics")
    .select("*")
    .eq("user_id", userId)
    .eq("category", category)
    .order("recorded_at", { ascending: false })
    .limit(500);

  if (dbError) throw dbError;
  if (!data) return [];

  // Group rows by metric_key, keeping only the latest per source
  const grouped = {};
  const seenSourceKey = new Set();
  for (const row of data) {
    const dedup = `${row.metric_key}::${row.source}`;
    if (seenSourceKey.has(dedup)) continue; // Only keep latest per source
    seenSourceKey.add(dedup);

    if (!grouped[row.metric_key]) grouped[row.metric_key] = [];
    grouped[row.metric_key].push(row);
  }

  // Pick the best row per metric using priority logic
  return Object.values(grouped).map((rows) => pickBestRow(rows));
}

/**
 * Get trend data for a specific metric (last N values).
 * Uses the highest-priority source that has data for consistency.
 */
async function getTrend(userId, metricKey, limit = 30) {
  const supabase = getServiceClient();

  // First, find which sources have data for this metric
  const { data: allData, error: dbError } = await supabase
    .from("health_metrics")
    .select("value_num, recorded_at, source")
    .eq("user_id", userId)
    .eq("metric_key", metricKey)
    .not("value_num", "is", null)
    .order("recorded_at", { ascending: false })
    .limit(200);

  if (dbError) throw dbError;
  if (!allData || allData.length === 0) return [];

  // For "steps" (max-value logic), return from all sources and let frontend handle
  if (USE_MAX_VALUE.has(metricKey)) {
    // Group by date, pick highest per day
    const byDate = {};
    for (const row of allData) {
      const date = row.recorded_at.split("T")[0];
      if (!byDate[date] || (row.value_num || 0) > (byDate[date].value_num || 0)) {
        byDate[date] = row;
      }
    }
    return Object.values(byDate)
      .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
      .slice(-limit);
  }

  // Pick the best source based on priority
  const sources = [...new Set(allData.map((r) => r.source))];
  const priorities = SOURCE_PRIORITY[metricKey];
  let bestSource = sources[0]; // Default to most recent
  if (priorities) {
    bestSource = sources.reduce((best, src) =>
      (priorities[src] || 99) < (priorities[best] || 99) ? src : best
    );
  }

  return allData
    .filter((r) => r.source === bestSource)
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
    .slice(-limit);
}

/**
 * Get all connected sources that have data for a user.
 */
async function getSources(userId) {
  const supabase = getServiceClient();
  const { data, error: dbError } = await supabase
    .from("health_metrics")
    .select("source")
    .eq("user_id", userId);

  if (dbError) throw dbError;
  const unique = [...new Set((data || []).map((r) => r.source))];
  return unique;
}

module.exports = { saveMetrics, getLatest, getLatestByCategory, getTrend, getSources };
