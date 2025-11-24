const { mapImpedanceArray, fetchLefuBodyData } = require("../services/lefu");

/**
 * Extract parameters from request and fetch body data from Lefu API
 * @param {Object} reqBody - Request body object
 * @returns {Promise<Object>} Result object with success status and body data
 */
async function processRecordData(reqBody) {
  try {
    // Extract impedance array - it might be in different places in the request
    // Try to find it in the request body structure
    let impedanceArray = null;
    let age, height, weightKg, sex, product;

    // Helper function to convert array-like structures to proper array
    const normalizeArray = (arr) => {
      if (!arr) return null;
      if (Array.isArray(arr)) {
        return arr
          .map((val) => {
            if (typeof val === "string") return parseFloat(val) || null;
            if (typeof val === "number") return val;
            if (val && typeof val === "object" && val.impedance !== undefined) {
              return parseFloat(val.impedance) || null;
            }
            return null;
          })
          .filter((val) => val !== null);
      }
      return null;
    };

    // Check various possible locations for impedance array
    if (Array.isArray(reqBody.impedance)) {
      impedanceArray = normalizeArray(reqBody.impedance);
    } else if (reqBody.impedanceArray) {
      impedanceArray = normalizeArray(reqBody.impedanceArray);
    } else if (reqBody.data && Array.isArray(reqBody.data.impedance)) {
      impedanceArray = normalizeArray(reqBody.data.impedance);
    } else if (reqBody.list && Array.isArray(reqBody.list) && reqBody.list[0]) {
      // Check in list[0].data format (from README example)
      const firstItem = reqBody.list[0];
      if (firstItem.data && Array.isArray(firstItem.data)) {
        // Extract impedance from data array
        impedanceArray = normalizeArray(firstItem.data);
      }
      // Also extract other params from list item
      weightKg = firstItem.weight;
      age = firstItem.age;
      height = firstItem.height;
      sex = firstItem.sex;
      product = firstItem.product;
    } else if (reqBody.impedance && typeof reqBody.impedance === "string") {
      // Try to parse as comma-separated or JSON string
      try {
        const parsed = JSON.parse(reqBody.impedance);
        impedanceArray = normalizeArray(parsed);
      } catch {
        // Try comma-separated
        impedanceArray = normalizeArray(reqBody.impedance.split(","));
      }
    }

    // Extract other parameters if not already found
    if (age === undefined && reqBody.age !== undefined) age = reqBody.age;
    if (height === undefined && reqBody.height !== undefined)
      height = reqBody.height;
    if (weightKg === undefined && reqBody.weightKg !== undefined)
      weightKg = reqBody.weightKg;
    if (weightKg === undefined && reqBody.weight !== undefined)
      weightKg = reqBody.weight;
    if (sex === undefined && reqBody.sex !== undefined) sex = reqBody.sex;
    if (product === undefined && reqBody.product !== undefined)
      product = reqBody.product;

    // If we don't have impedance array, log and return
    if (
      !impedanceArray ||
      !Array.isArray(impedanceArray) ||
      impedanceArray.length < 10
    ) {
      console.log("⚠️  Could not find valid impedance array in request");
      console.log("   Request body keys:", Object.keys(reqBody));
      console.log(
        "   Request body sample:",
        JSON.stringify(reqBody, null, 2).substring(0, 1000)
      );
      return {
        success: false,
        error: "Impedance array not found or invalid (need 10 values)",
      };
    }

    // Map impedance array to API parameters
    const impedanceParams = mapImpedanceArray(impedanceArray);

    // Build API request parameters
    const apiParams = {
      ...impedanceParams,
      age: 20,
      height: 170,
      weightKg: 70,
      sex: 1,
      product: 5,
    };

    console.log("📋 API Parameters:", JSON.stringify(apiParams, null, 2));

    // Fetch body data from Lefu API
    const result = await fetchLefuBodyData(apiParams);

    if (result.success && result.data && result.data.data) {
      const bodyData = result.data.data.lefuBodyData || [];
      console.log(
        `✅ Extracted ${bodyData.length} body data items from API response`
      );
      return { success: true, bodyData: bodyData };
    } else {
      console.error("❌ Failed to extract body data from API response");
      return {
        success: false,
        error: result.error || "Failed to fetch body data",
      };
    }
  } catch (err) {
    console.error("❌ Error processing record data:", err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  processRecordData,
};
