const { generateAllGoalSummaries } = require("../services/openai");
const { getSupabaseClient } = require("../services/supabase");

/**
 * Extract metric values from body data array
 * @param {Array} bodyData - Array of body data items
 * @returns {Object} Object with metric keys and values
 */
function extractMetricsFromBodyData(bodyData) {
  const metrics = {};

  if (!Array.isArray(bodyData)) {
    return metrics;
  }

  bodyData.forEach((item) => {
    const key =
      item.bodyParamKey ||
      item.body_param_key ||
      item.bodyParam ||
      item.body_param;
    const value =
      item.currentValue !== undefined
        ? item.currentValue
        : item.current_value !== undefined
        ? item.current_value
        : null;

    if (key && value !== null && value !== undefined) {
      // Convert to number if possible
      const numValue = typeof value === "string" ? parseFloat(value) : value;
      metrics[key] = isNaN(numValue) ? value : numValue;
    }
  });

  return metrics;
}

/**
 * Get metrics from two weeks ago for a user from the database
 * @param {string} scaleUserId - User ID
 * @param {number} currentRecordId - Current record ID to exclude
 * @param {Date} currentDate - Current date/time
 * @returns {Promise<Object|null>} Metrics from two weeks ago or null
 */
async function getTwoWeeksAgoMetrics(
  scaleUserId,
  currentRecordId,
  currentDate
) {
  const supabase = getSupabaseClient();
  if (!supabase || !scaleUserId) {
    return null;
  }

  try {
    // Calculate date two weeks ago (14 days)
    const twoWeeksAgo = new Date(currentDate);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    // Get records from around two weeks ago (within a 3-day window for flexibility)
    const threeDaysAgo = new Date(twoWeeksAgo);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const threeDaysAfter = new Date(twoWeeksAgo);
    threeDaysAfter.setDate(threeDaysAfter.getDate() + 3);

    // Get the closest record to two weeks ago
    const { data, error } = await supabase
      .from("scale_records")
      .select("lefu_body_data, created_at")
      .eq("scale_user_id", scaleUserId)
      .neq("id", currentRecordId)
      .gte("created_at", threeDaysAgo.toISOString())
      .lte("created_at", threeDaysAfter.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // If no record found in the window, try to get the oldest record before current
    if (error || !data || !data.lefu_body_data) {
      const { data: fallbackData, error: fallbackError } = await supabase
        .from("scale_records")
        .select("lefu_body_data, created_at")
        .eq("scale_user_id", scaleUserId)
        .neq("id", currentRecordId)
        .lt("created_at", currentDate.toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fallbackError || !fallbackData || !fallbackData.lefu_body_data) {
        return null;
      }

      return extractMetricsFromBodyData(fallbackData.lefu_body_data);
    }

    return extractMetricsFromBodyData(data.lefu_body_data);
  } catch (err) {
    console.error("❌ Error fetching two weeks ago metrics:", err.message);
    return null;
  }
}

/**
 * Generate and return summaries for all goal cards
 * @param {Array} bodyData - Current body data array
 * @param {string} scaleUserId - User ID for fetching previous metrics
 * @param {number} currentRecordId - Current record ID
 * @returns {Promise<Object>} Object with summaries (header + body) for each goal
 */
async function generateSummariesForRecord(
  bodyData,
  scaleUserId = null,
  currentRecordId = null
) {
  try {
    // Extract current metrics
    const currentMetrics = extractMetricsFromBodyData(bodyData);

    // Get metrics from two weeks ago if user ID is available
    let twoWeeksAgoMetrics = null;
    if (scaleUserId && currentRecordId) {
      twoWeeksAgoMetrics = await getTwoWeeksAgoMetrics(
        scaleUserId,
        currentRecordId,
        new Date()
      );
    }

    // Generate summaries for all goals
    const summaries = await generateAllGoalSummaries(
      currentMetrics,
      twoWeeksAgoMetrics
    );

    return summaries;
  } catch (error) {
    console.error("❌ Error generating summaries:", error.message);
    // Return default summaries on error
    const defaultSummary = {
      header: "Tracking progress",
      body: "Progress tracking in progress...",
    };
    return {
      Overview: defaultSummary,
      Recovery: defaultSummary,
      Energy: defaultSummary,
      Longevity: defaultSummary,
      "Weight Loss": defaultSummary,
      "Pain Relief": defaultSummary,
      "General Health": defaultSummary,
    };
  }
}

module.exports = {
  extractMetricsFromBodyData,
  getTwoWeeksAgoMetrics,
  generateSummariesForRecord,
};
