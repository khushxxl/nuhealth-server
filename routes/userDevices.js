const express = require("express");
const router = express.Router();
const { getServiceClient } = require("../services/supabase");
const { success, error } = require("../utils/apiResponse");

// GET /api/devices - Get all devices for authenticated user
router.get("/devices", async (req, res) => {
  try {
    const supabase = getServiceClient();

    // Look up user by email
    const { data: userData, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.email)
      .single();

    if (lookupError || !userData) {
      return success(res, []);
    }

    const { data, error: dbError } = await supabase
      .from("devices")
      .select("*")
      .eq("user_id", userData.id);

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, data || []);
  } catch (err) {
    console.error("❌ GET /api/devices error:", err.message);
    return error(res, "Failed to fetch devices");
  }
});

module.exports = router;
