const { createClient } = require("@supabase/supabase-js");
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require("../config/constants");

// Initialize Supabase client
let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log("✅ Supabase client initialized");
} else {
  console.log(
    "⚠️  Supabase credentials not found - data will not be saved to database"
  );
  console.log(
    "   Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables"
  );
}

/**
 * Map lefuBodyData item to scale_measurements format
 * @param {Object} bodyDataItem - A single item from lefuBodyData array
 * @returns {Object} Mapped measurement object for scale_measurements table
 */
function mapBodyDataToMeasurement(bodyDataItem) {
  // Helper to get value supporting both camelCase and snake_case
  const getValue = (camelKey, snakeKey) => {
    return bodyDataItem[camelKey] ?? bodyDataItem[snakeKey] ?? null;
  };

  // Helper to convert value to numeric if possible
  const toNumeric = (val) => {
    if (val === null || val === undefined) return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : num;
  };

  // Helper to convert value to text if not numeric
  const toText = (val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === "number") return null; // Use numeric field instead
    return String(val);
  };

  const currentValue = getValue("currentValue", "current_value");
  const currentValueNum = toNumeric(currentValue);
  const currentValueText =
    currentValueNum === null ? toText(currentValue) : null;

  return {
    body_param_key: getValue("bodyParamKey", "body_param_key"),
    body_param_name: getValue("bodyParamName", "body_param_name"),
    unit: getValue("unit", "unit"),
    current_value_num: currentValueNum,
    current_value_text: currentValueText,
    standard_title: getValue("standardTitle", "standard_title"),
    current_standard: getValue("currentStandard", "current_standard"),
    stand_color: getValue("standColor", "stand_color"),
    color_array: getValue("colorArray", "color_array"),
    standard_array: getValue("standardArray", "standard_array"),
    standard_title_array: getValue(
      "standardTitleArray",
      "standard_title_array"
    ),
    introduction: getValue("introduction", "introduction"),
    stand_suggestion: getValue("standSuggestion", "stand_suggestion"),
    stand_evaluation: getValue("standEvaluation", "stand_evaluation"),
  };
}

/**
 * Save record data to Supabase
 * @param {Object} recordData - The record data to save
 * @param {Array} lefuBodyData - Optional body data from Lefu API
 * @returns {Promise<Object>} Result object with success status
 */
async function saveRecordToSupabase(recordData, lefuBodyData = null) {
  if (!supabase) {
    console.log("⚠️  Supabase not configured - skipping database save");
    return { success: false, error: "Supabase not configured" };
  }

  try {
    // Extract key fields for easier querying
    const { code, msg, data } = recordData;

    if (!data) {
      console.log("⚠️  No data field in record - skipping save");
      return { success: false, error: "No data field" };
    }

    const { version, errorType } = data;

    // Extract scale_user_id from recordData (could be at root level or in data)
    const scaleUserId = recordData.scaleUserId || data.scaleUserId || null;

    // Use lefuBodyData from API if provided, otherwise use from recordData
    const bodyData = lefuBodyData || data.lefuBodyData || [];

    // Prepare the record for insertion
    const recordToInsert = {
      code: code || null,
      msg: msg || null,
      version: version || null,
      error_type: errorType || null,
      lefu_body_data: bodyData,
      full_data: recordData, // Store complete data as JSONB for reference
      scale_user_id: scaleUserId,
    };

    console.log("💾 Saving record to Supabase...");
    const { data: insertedData, error } = await supabase
      .from("scale_records")
      .insert([recordToInsert])
      .select();

    if (error) {
      console.error("❌ Supabase insert error:", error);
      return { success: false, error: error.message };
    }

    const recordId = insertedData[0]?.id;
    if (!recordId) {
      console.error("❌ No record ID returned from insert");
      return { success: false, error: "No record ID returned" };
    }

    console.log(`✅ Record saved to Supabase successfully (ID: ${recordId})`);

    // Return early with record ID so summaries can be generated and updated
    const result = { success: true, data: insertedData[0], recordId };

    // Now save individual measurements to scale_measurements table
    if (Array.isArray(bodyData) && bodyData.length > 0) {
      console.log(
        `💾 Saving ${bodyData.length} measurements to scale_measurements...`
      );

      // Filter and map body data items, only including those with body_param_key (required field)
      const measurementsToInsert = bodyData
        .filter(
          (item) =>
            item &&
            (item.bodyParamKey ||
              item.body_param_key ||
              item.bodyParam ||
              item.body_param)
        )
        .map((item) => ({
          scale_record_id: recordId,
          ...mapBodyDataToMeasurement(item),
        }))
        .filter((m) => m.body_param_key); // Double-check we have the required field

      if (measurementsToInsert.length === 0) {
        console.log(
          "⚠️  No valid measurements to save (missing body_param_key)"
        );
      } else {
        const { data: insertedMeasurements, error: measurementsError } =
          await supabase
            .from("scale_measurements")
            .insert(measurementsToInsert)
            .select();

        if (measurementsError) {
          console.error("❌ Error saving measurements:", measurementsError);
          // Don't fail the whole operation, just log the error
          console.log("⚠️  Record saved but measurements failed to save");
        } else {
          console.log(
            `✅ Saved ${
              insertedMeasurements?.length || 0
            } measurements to scale_measurements`
          );
        }
      }
    } else {
      console.log("⚠️  No body data to save as measurements");
    }

    return result;
  } catch (err) {
    console.error("❌ Error saving to Supabase:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Update goal summaries for a record
 * @param {number} recordId - The record ID to update
 * @param {Object} summaries - Object with summaries for each goal
 * @returns {Promise<Object>} Result object with success status
 */
async function updateGoalSummaries(recordId, summaries) {
  if (!supabase) {
    console.log("⚠️  Supabase not configured - skipping summary update");
    return { success: false, error: "Supabase not configured" };
  }

  try {
    const { error } = await supabase
      .from("scale_records")
      .update({ goal_summaries: summaries })
      .eq("id", recordId);

    if (error) {
      console.error("❌ Error updating goal summaries:", error);
      return { success: false, error: error.message };
    }

    console.log("✅ Goal summaries updated successfully");
    return { success: true };
  } catch (err) {
    console.error("❌ Error updating goal summaries:", err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  saveRecordToSupabase,
  updateGoalSummaries,
  getSupabaseClient: () => supabase,
};
