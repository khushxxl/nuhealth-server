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

// PUT /api/goals - Upsert latest user_goals row. Body: { goalsData: {...} }
// Replaces the client-side "find latest then update or insert" pattern that
// previously ran in goal-setting-screen and body-metric-detail-screen.
router.put("/goals", async (req, res) => {
  try {
    const goalsData = req.body?.goalsData;
    if (!goalsData || typeof goalsData !== "object") {
      return error(res, "goalsData object is required", 400);
    }

    const supabase = getServiceClient();
    const { data: userData, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.email)
      .single();

    if (lookupError || !userData) return error(res, "User not found", 404);

    const { data: existing, error: existingError } = await supabase
      .from("user_goals")
      .select("id")
      .eq("user_id", userData.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError && existingError.code !== "PGRST116") {
      return error(res, existingError.message, 500);
    }

    if (existing) {
      const { data, error: updateError } = await supabase
        .from("user_goals")
        .update(goalsData)
        .eq("id", existing.id)
        .select()
        .single();
      if (updateError) return error(res, updateError.message, 500);
      return success(res, data);
    }

    const { data, error: insertError } = await supabase
      .from("user_goals")
      .insert({ user_id: userData.id, ...goalsData })
      .select()
      .single();
    if (insertError) return error(res, insertError.message, 500);
    return success(res, data);
  } catch (err) {
    console.error("❌ PUT /api/goals error:", err.message);
    return error(res, "Failed to save goals");
  }
});

module.exports = router;
