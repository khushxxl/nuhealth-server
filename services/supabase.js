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

    console.log("✅ Record saved to Supabase successfully");
    console.log(`   Record ID: ${insertedData[0]?.id || "unknown"}`);
    return { success: true, data: insertedData[0] };
  } catch (err) {
    console.error("❌ Error saving to Supabase:", err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  saveRecordToSupabase,
  getSupabaseClient: () => supabase,
};
