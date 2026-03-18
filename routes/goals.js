const express = require("express");
const router = express.Router();
const { getServiceClient } = require("../services/supabase");
const { success, error } = require("../utils/apiResponse");

// GET /api/goals - Get latest goals for authenticated user
router.get("/goals", async (req, res) => {
  try {
    const supabase = getServiceClient();

    // Look up user by email
    const { data: userData, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.email)
      .single();

    if (lookupError || !userData) {
      return success(res, null);
    }

    const { data, error: dbError } = await supabase
      .from("user_goals")
      .select("*")
      .eq("user_id", userData.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dbError && dbError.code !== "PGRST116") {
      return error(res, dbError.message, 500);
    }

    return success(res, data || null);
  } catch (err) {
    console.error("❌ GET /api/goals error:", err.message);
    return error(res, "Failed to fetch goals");
  }
});

module.exports = router;
