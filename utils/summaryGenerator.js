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
      metrics[key] = value;
    }
  });

  return metrics;
}

/**
 * Get previous metrics for a user from the database
 * @param {string} scaleUserId - User ID
 * @param {number} currentRecordId - Current record ID to exclude
 * @returns {Promise<Object|null>} Previous metrics or null
 */
async function getPreviousMetrics(scaleUserId, currentRecordId) {
  const supabase = getSupabaseClient();
  if (!supabase || !scaleUserId) {
    return null;
  }

  try {
    // Get the most recent record before the current one
    const { data, error } = await supabase
      .from("scale_records")
      .select("lefu_body_data")
      .eq("scale_user_id", scaleUserId)
      .neq("id", currentRecordId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data || !data.lefu_body_data) {
      return null;
    }

    return extractMetricsFromBodyData(data.lefu_body_data);
  } catch (err) {
    console.error("❌ Error fetching previous metrics:", err.message);
    return null;
  }
}

/**
 * Generate and return summaries for all goal cards
 * @param {Array} bodyData - Current body data array
 * @param {string} scaleUserId - User ID for fetching previous metrics
 * @param {number} currentRecordId - Current record ID
 * @returns {Promise<Object>} Object with summaries for each goal
 */
async function generateSummariesForRecord(
  bodyData,
  scaleUserId = null,
  currentRecordId = null
) {
  try {
    // Extract current metrics
    const currentMetrics = extractMetricsFromBodyData(bodyData);

    // Get previous metrics if user ID is available
    let previousMetrics = null;
    if (scaleUserId && currentRecordId) {
      previousMetrics = await getPreviousMetrics(scaleUserId, currentRecordId);
    }

    // Generate summaries for all goals
    const summaries = await generateAllGoalSummaries(
      currentMetrics,
      previousMetrics
    );

    return summaries;
  } catch (error) {
    console.error("❌ Error generating summaries:", error.message);
    // Return default summaries on error
    return {
      "General Health": "Progress tracking in progress...",
      Recovery: "Progress tracking in progress...",
      Energy: "Progress tracking in progress...",
      Longevity: "Progress tracking in progress...",
      "Weight Loss": "Progress tracking in progress...",
      "Pain Relief": "Progress tracking in progress...",
    };
  }
}

module.exports = {
  extractMetricsFromBodyData,
  getPreviousMetrics,
  generateSummariesForRecord,
};

