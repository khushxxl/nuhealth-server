const express = require("express");
const router = express.Router();
const { getServiceClient } = require("../services/supabase");
const { success, error } = require("../utils/apiResponse");

/**
 * Helper to get user ID from auth email
 */
async function getUserId(supabase, email) {
  const { data, error: lookupError } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .single();

  if (lookupError || !data) return null;
  return data.id;
}

// GET /api/sessions - Get all sessions for authenticated user
router.get("/sessions", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const userId = await getUserId(supabase, req.user.email);
    if (!userId) return success(res, []);

    const { data, error: dbError } = await supabase
      .from("log_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, data || []);
  } catch (err) {
    console.error("❌ GET /api/sessions error:", err.message);
    return error(res, "Failed to fetch sessions");
  }
});

// POST /api/sessions - Create a new session
router.post("/sessions", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const userId = await getUserId(supabase, req.user.email);
    if (!userId) return error(res, "User not found", 404);

    const { type, duration, notes, intensity, customType } = req.body;

    const { data, error: dbError } = await supabase
      .from("log_sessions")
      .insert({
        user_id: userId,
        type,
        duration,
        notes: notes || "",
        intensity: intensity || 5,
        custom_type: customType || null,
      })
      .select()
      .single();

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, data, "Session created", 201);
  } catch (err) {
    console.error("❌ POST /api/sessions error:", err.message);
    return error(res, "Failed to create session");
  }
});

// PUT /api/sessions/:id - Update a session
router.put("/sessions/:id", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { id } = req.params;
    const { type, duration, notes, intensity, customType } = req.body;

    const updateData = {};
    if (type !== undefined) updateData.type = type;
    if (duration !== undefined) updateData.duration = duration;
    if (notes !== undefined) updateData.notes = notes;
    if (intensity !== undefined) updateData.intensity = intensity;
    if (customType !== undefined) updateData.custom_type = customType || null;

    const { data, error: dbError } = await supabase
      .from("log_sessions")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, data, "Session updated");
  } catch (err) {
    console.error("❌ PUT /api/sessions/:id error:", err.message);
    return error(res, "Failed to update session");
  }
});

// DELETE /api/sessions/:id - Delete a session
router.delete("/sessions/:id", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { id } = req.params;

    const { error: dbError } = await supabase
      .from("log_sessions")
      .delete()
      .eq("id", id);

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, null, "Session deleted");
  } catch (err) {
    console.error("❌ DELETE /api/sessions/:id error:", err.message);
    return error(res, "Failed to delete session");
  }
});

module.exports = router;
