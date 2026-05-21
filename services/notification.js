const axios = require("axios");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Send an Expo push notification
 * @param {string} pushToken - Expo push token (e.g. "ExponentPushToken[xxx]")
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {Object} [data] - Optional data payload available to the client when
 *   the user taps the notification (e.g. `{ type: "paywall" }` to deep-link).
 * @returns {Promise<Object>} Result object with success status
 */
async function sendPushNotification(pushToken, title, body, data) {
  if (!pushToken) {
    console.log("⚠️  No push token provided - skipping notification");
    return { success: false, error: "No push token" };
  }

  try {
    console.log(
      `📲 Sending push notification to ${pushToken.substring(0, 30)}...`,
    );
    const payload = {
      to: pushToken,
      title,
      body,
      sound: "default",
    };
    if (data && typeof data === "object") payload.data = data;
    const response = await axios.post(EXPO_PUSH_URL, payload);

    if (response.data?.data?.status === "ok") {
      console.log("✅ Push notification sent successfully");
      return { success: true };
    }

    // Expo returns errors per-message in data.data
    const ticketError =
      response.data?.data?.message || response.data?.data?.details?.error;
    if (ticketError) {
      console.error("❌ Push notification error:", ticketError);
      return { success: false, error: ticketError };
    }

    console.log("✅ Push notification queued");
    return { success: true };
  } catch (err) {
    console.error("❌ Error sending push notification:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendPushNotification };
