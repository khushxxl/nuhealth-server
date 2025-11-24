const axios = require("axios");
const {
  LEFU_BASE_URL,
  LEFU_APP_KEY,
  LEFU_APP_SECRET,
} = require("../config/constants");

/**
 * Get authentication token from Lefu API
 * Always fetches a fresh token (no caching - token must be refreshed every time)
 * @returns {Promise<string|null>} The authentication token or null if failed
 */
async function getLefuToken() {
  try {
    console.log("🔑 Fetching fresh Lefu API token...");
    const response = await axios.post(
      `${LEFU_BASE_URL}/openapi/user/refreshToken`,
      {
        appKey: LEFU_APP_KEY,
        appSecret: LEFU_APP_SECRET,
      }
    );

    // Only log response.data, not the entire response object (which has circular references)
    console.log("📋 Token response:", JSON.stringify(response.data, null, 2));

    if (response.data && response.data.code === 200 && response.data.data) {
      const token = response.data.data.token;
      console.log("✅ Lefu token obtained successfully");
      console.log(`   Token: ${token.substring(0, 20)}...`);
      return token;
    } else {
      console.error("❌ Failed to get token:", response.data);
      return null;
    }
  } catch (error) {
    console.error("❌ Error fetching Lefu token:", error.message);
    if (error.response) {
      console.error("   Response:", error.response.data);
    }
    return null;
  }
}

/**
 * Map impedance array to API parameters
 * @param {Array} impedanceArray - Array of 10 impedance values
 * @returns {Object} Mapped impedance parameters
 */
function mapImpedanceArray(impedanceArray) {
  if (!Array.isArray(impedanceArray) || impedanceArray.length < 10) {
    console.log("⚠️  Invalid impedance array, expected 10 elements");
    return {};
  }

  return {
    z20KhzRightArmEnCode: impedanceArray[0],
    z100KhzRightArmEnCode: impedanceArray[1],
    z20KhzLeftArmEnCode: impedanceArray[2],
    z100KhzLeftArmEnCode: impedanceArray[3],
    z20KhzTrunkEnCode: impedanceArray[4],
    z100KhzTrunkEnCode: impedanceArray[5],
    z20KhzRightLegEnCode: impedanceArray[6],
    z100KhzRightLegEnCode: impedanceArray[7],
    z20KhzLeftLegEnCode: impedanceArray[8],
    z100KhzLeftLegEnCode: impedanceArray[9],
  };
}

/**
 * Fetch body data from Lefu API
 * @param {Object} params - API parameters (impedance values, age, height, etc.)
 * @returns {Promise<Object>} Result object with success status and data
 */
async function fetchLefuBodyData(params) {
  const token = await getLefuToken();
  if (!token) {
    return { success: false, error: "Failed to get token" };
  }

  try {
    console.log("📡 Fetching body data from Lefu API...");
    const response = await axios.get(
      `${LEFU_BASE_URL}/openapi-bodydata/bodyData/V1_7_1/getAcLfBodyData8`,
      {
        params: params,
        headers: {
          token: token,
          "Accept-Language": "en",
        },
      }
    );

    if (response.data && response.data.code === 200) {
      console.log("✅ Body data fetched successfully");
      console.log(`   Version: ${response.data.data?.version || "unknown"}`);
      //   console.log(JSON.stringify(response.data.data, null, 2));
      console.log(
        `   Body data items: ${response.data.data?.lefuBodyData?.length || 0}`
      );
      return { success: true, data: response.data };
    } else {
      console.error("❌ Failed to fetch body data:", response.data);
      return { success: false, error: response.data?.msg || "Unknown error" };
    }
  } catch (error) {
    console.error("❌ Error fetching body data:", error.message);
    if (error.response) {
      console.error("   Response:", error.response.data);
    }
    return { success: false, error: error.message };
  }
}

module.exports = {
  getLefuToken,
  mapImpedanceArray,
  fetchLefuBodyData,
};
