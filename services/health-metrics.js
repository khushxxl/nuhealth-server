const { getServiceClient } = require("./supabase");

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
 * Returns one row per metric (the latest).
 */
async function getLatestByCategory(userId, category) {
  const supabase = getServiceClient();

  // Fetch recent metrics for the category, then deduplicate in JS
  // (Supabase doesn't support DISTINCT ON easily via the client)
  const { data, error: dbError } = await supabase
    .from("health_metrics")
    .select("*")
    .eq("user_id", userId)
    .eq("category", category)
    .order("recorded_at", { ascending: false })
    .limit(200);

  if (dbError) throw dbError;
  if (!data) return [];

  // Keep only the latest row per metric_key
  const seen = new Set();
  return data.filter((row) => {
    if (seen.has(row.metric_key)) return false;
    seen.add(row.metric_key);
    return true;
  });
}

/**
 * Get trend data for a specific metric (last N values).
 */
async function getTrend(userId, metricKey, limit = 30) {
  const supabase = getServiceClient();
  const { data, error: dbError } = await supabase
    .from("health_metrics")
    .select("value_num, recorded_at, source")
    .eq("user_id", userId)
    .eq("metric_key", metricKey)
    .not("value_num", "is", null)
    .order("recorded_at", { ascending: true })
    .limit(limit);

  if (dbError) throw dbError;
  return data || [];
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
