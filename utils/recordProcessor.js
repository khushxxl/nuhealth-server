const { mapImpedanceArray, fetchLefuBodyData } = require("../services/lefu");
const { getUserProfile } = require("../services/supabase");
const {
  applyCorrection,
  getParamKey,
  getCurrentValue,
  setCurrentValue,
  getItemRole,
  extractMetrics,
} = require("./biyoCorrection");

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

    let profileForBiyo = null;

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
        profileForBiyo = profile;

        // Only use profile data if request didn't provide it
        if (age === undefined && profile.age !== null) {
          age = parseInt(profile.age, 10);
          console.log(`   ✅ Using age from profile: ${age}`);
        }
        if (height === undefined && profile.height !== null) {
          height = Math.round(parseFloat(profile.height));
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
          `   ⚠️  Could not fetch user profile: ${
            profileResult.error || "Unknown error"
          }`,
        );
      }
    }

    // ─── Sanitize all parameters to proper types for Lefu API ───
    // Lefu API requires: age (int), height (int cm), weight (float kg), sex (int 0/1), product (int)

    // Height: must be integer cm
    const DEFAULT_HEIGHT_CM = 195;
    const heightNum =
      height !== undefined && height !== null && height !== ""
        ? Number(height)
        : NaN;
    if (!Number.isFinite(heightNum) || heightNum <= 0) {
      height = DEFAULT_HEIGHT_CM;
      console.log(`   ✅ Using default height: ${height} cm`);
    } else {
      height = Math.round(heightNum);
    }

    // Age: must be integer
    if (age !== undefined && age !== null) {
      age = parseInt(String(age), 10);
      if (isNaN(age) || age <= 0 || age > 150) age = undefined;
    }

    // Weight: must be a number (float OK)
    if (weightKg !== undefined && weightKg !== null) {
      weightKg = parseFloat(String(weightKg));
      if (isNaN(weightKg) || weightKg <= 0) weightKg = undefined;
    }

    // Sex: must be integer (1=male, 2=female)
    if (sex !== undefined && sex !== null) {
      sex = parseInt(String(sex), 10);
      if (isNaN(sex) || (sex !== 1 && sex !== 2)) sex = undefined;
    }

    // Product: must be integer
    if (product !== undefined && product !== null) {
      product = parseInt(String(product), 10);
      if (isNaN(product)) product = undefined;
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

    // Lefu API uses gender: 0 = female, 1 = male. We use sex: 1 = male, 2 = female.
    const sexForLefu = sex === 1 ? 1 : sex === 2 ? 0 : sex;

    // Build API request parameters using extracted values
    const apiParams = {
      ...impedanceParams,
      age: age,
      height: height,
      weightKg: weightKg,
      sex: sexForLefu,
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
      `   Impedance values: ${
        Object.keys(impedanceParams).length
      } parameters ✅`,
    );

    // Fetch body data from Lefu API
    const result = await fetchLefuBodyData(apiParams);

    if (result.success && result.data && result.data.data) {
      const bodyData = result.data.data.lefuBodyData || [];
      console.log(
        `✅ Extracted ${bodyData.length} body data items from API response`,
      );

      // BIYO correction: classify, adjust BF%, rebalance FFM components
      let mutatedBodyData = bodyData;
      const weightNum =
        weightKg != null && weightKg !== "" ? Number(weightKg) : null;
      const heightNumForBiyo = Number(height);
      const sexNum =
        sex !== undefined && sex !== null && sex !== "" ? Number(sex) : null;
      if (
        Array.isArray(bodyData) &&
        bodyData.length > 0 &&
        Number.isFinite(weightNum) &&
        weightNum > 0 &&
        Number.isFinite(heightNumForBiyo) &&
        heightNumForBiyo > 0 &&
        (sexNum === 1 || sexNum === 2)
      ) {
        let userBodyType = profileForBiyo?.user_body_type ?? null;
        if (userId && profileForBiyo == null) {
          const profileResult = await getUserProfile(userId);
          if (profileResult.success && profileResult.profile)
            userBodyType = profileResult.profile.user_body_type ?? null;
        }
        const biyo = applyCorrection(
          bodyData,
          heightNumForBiyo,
          weightNum,
          sexNum,
          userBodyType,
        );
        mutatedBodyData = biyo.mutatedBodyData;
        if (biyo.applied) {
          console.log(
            `   BIYO correction applied: bucket=${biyo.bucket}, BF% corrected to ${biyo.bfCorrected?.toFixed(1)}%`,
          );
        }
      }

      // DEXA calibration: apply user's stored dexa_bf_offset if present
      let dexaProfile = profileForBiyo;
      if (!dexaProfile && userId) {
        const profileResult = await getUserProfile(userId);
        if (profileResult.success && profileResult.profile)
          dexaProfile = profileResult.profile;
      }

      const dexaOffset = dexaProfile?.dexa_bf_offset;
      if (dexaOffset != null && Number.isFinite(Number(dexaOffset)) && Number(dexaOffset) !== 0) {
        const offset = Number(dexaOffset);
        const preDexaMetrics = extractMetrics(mutatedBodyData, null, null);
        const currentBfPct = preDexaMetrics.bfPct;
        const currentWeight = preDexaMetrics.weight;
        const currentFfm = preDexaMetrics.ffm;

        if (currentBfPct != null && currentWeight != null && currentWeight > 0 && currentFfm != null && currentFfm > 0) {
          const bfNew = currentBfPct + offset;
          const fatMassNew = currentWeight * (bfNew / 100);
          const ffmNew = currentWeight - fatMassNew;
          const k = ffmNew / currentFfm;

          for (const item of mutatedBodyData) {
            const key = getParamKey(item);
            const role = getItemRole(key);
            const val = getCurrentValue(item);
            if (val === null) continue;

            switch (role) {
              case "weight":
                break;
              case "bodyFatPct":
                setCurrentValue(item, bfNew);
                break;
              case "fatMass":
                setCurrentValue(item, fatMassNew);
                break;
              case "ffm":
                setCurrentValue(item, ffmNew);
                break;
              case "visceral":
                break;
              case "muscleMass":
              case "ffmComponent":
                setCurrentValue(item, val * k);
                break;
              default:
                break;
            }
          }

          // Recalculate percentage metrics
          const mutatedValues = {};
          for (const item of mutatedBodyData) {
            const key = getParamKey(item);
            const val = getCurrentValue(item);
            if (val !== null) mutatedValues[key] = val;
          }

          const w = mutatedValues["ppWeightKg"] ?? currentWeight;
          const pctRecalc = {
            ppMusclePercentage: mutatedValues["ppMuscleKg"] != null ? (mutatedValues["ppMuscleKg"] / w) * 100 : null,
            ppProteinPercentage: mutatedValues["ppProteinKg"] != null ? (mutatedValues["ppProteinKg"] / w) * 100 : null,
            ppWaterPercentage: mutatedValues["ppWaterKg"] != null ? (mutatedValues["ppWaterKg"] / w) * 100 : null,
            ppBodySkeletal: mutatedValues["ppBodySkeletalKg"] != null ? (mutatedValues["ppBodySkeletalKg"] / w) * 100 : null,
          };

          for (const item of mutatedBodyData) {
            const key = getParamKey(item);
            if (pctRecalc[key] != null) {
              setCurrentValue(item, pctRecalc[key]);
            }
          }

          // Clamp health score
          for (const item of mutatedBodyData) {
            const key = getParamKey(item);
            if (key === "ppBodyScore") {
              const val = getCurrentValue(item);
              if (val !== null && val > 100) setCurrentValue(item, 100);
            }
          }

          console.log(
            `   DEXA calibration applied: offset=${offset.toFixed(2)}pp, BF% adjusted to ${bfNew.toFixed(1)}%`,
          );
        }
      }

      return {
        success: true,
        bodyData,
        mutatedBodyData,
      };
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
