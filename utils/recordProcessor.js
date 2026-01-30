const { mapImpedanceArray, fetchLefuBodyData } = require("../services/lefu");
const { getUserProfile } = require("../services/supabase");

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

    // Extract user ID for database lookup
    const userId =
      (reqBody.list && reqBody.list[0] && reqBody.list[0].userid) ||
      reqBody.userid ||
      null;

    // Debug logging for extracted parameters from request
    console.log("📊 Extracted Parameters from Request:");
    console.log(`   User ID: ${userId || "(MISSING)"}`);
    console.log(`   Age: ${age} ${age === undefined ? "(MISSING)" : ""}`);
    console.log(
      `   Height: ${height} ${height === undefined ? "(MISSING)" : ""}`,
    );
    console.log(
      `   Weight: ${weightKg} ${weightKg === undefined ? "(MISSING)" : ""}`,
    );
    console.log(`   Sex: ${sex} ${sex === undefined ? "(MISSING)" : ""}`);
    console.log(
      `   Product: ${product} ${product === undefined ? "(MISSING)" : ""}`,
    );

    // If we're missing critical parameters, try to fetch from user profile
    if (
      userId &&
      (age === undefined || height === undefined || sex === undefined)
    ) {
      console.log(
        "🔍 Missing parameters, fetching user profile from database...",
      );
      const profileResult = await getUserProfile(userId);

      if (profileResult.success && profileResult.profile) {
        const profile = profileResult.profile;

        // Only use profile data if request didn't provide it
        if (age === undefined && profile.age !== null) {
          age = profile.age;
          console.log(`   ✅ Using age from profile: ${age}`);
        }
        if (height === undefined && profile.height !== null) {
          height = profile.height;
          console.log(`   ✅ Using height from profile: ${height}`);
        }
        if (sex === undefined && profile.gender !== null) {
          // Map gender text to sex number (1 = male, 2 = female)
          const genderMap = {
            male: 1,
            female: 2,
            m: 1,
            f: 2,
          };
          sex =
            genderMap[profile.gender?.toLowerCase()] ||
            (profile.gender === "1"
              ? 1
              : profile.gender === "2"
                ? 2
                : undefined);
          console.log(
            `   ✅ Using gender from profile: ${profile.gender} (mapped to sex: ${sex})`,
          );
        }
      } else {
        console.log(
          `   ⚠️  Could not fetch user profile: ${profileResult.error || "Unknown error"}`,
        );
      }
    }

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
        JSON.stringify(reqBody, null, 2).substring(0, 1000),
      );
      return {
        success: false,
        error: "Impedance array not found or invalid (need 10 values)",
      };
    }

    // Map impedance array to API parameters
    const impedanceParams = mapImpedanceArray(impedanceArray);

    // Build API request parameters using extracted values
    const apiParams = {
      ...impedanceParams,
      age: age,
      height: height,
      weightKg: weightKg,
      sex: sex,
      product: product || 5,
    };

    console.log("\n📋 Final API Parameters (sending to Lefu API):");
    console.log(`   Age: ${age} ${age === undefined ? "❌ MISSING" : "✅"}`);
    console.log(
      `   Height: ${height} ${height === undefined ? "❌ MISSING" : "✅"}`,
    );
    console.log(
      `   Weight: ${weightKg} ${weightKg === undefined ? "❌ MISSING" : "✅"}`,
    );
    console.log(`   Sex: ${sex} ${sex === undefined ? "❌ MISSING" : "✅"}`);
    console.log(`   Product: ${apiParams.product} ✅`);
    console.log(
      `   Impedance values: ${Object.keys(impedanceParams).length} parameters ✅`,
    );

    // Fetch body data from Lefu API
    const result = await fetchLefuBodyData(apiParams);

    if (result.success && result.data && result.data.data) {
      const bodyData = result.data.data.lefuBodyData || [];
      console.log(
        `✅ Extracted ${bodyData.length} body data items from API response`,
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
