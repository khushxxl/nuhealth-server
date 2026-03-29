const express = require("express");
const router = express.Router();
const { getServiceClient } = require("../services/supabase");
const { success, error } = require("../utils/apiResponse");

// GET /api/users/me - Fetch authenticated user profile
router.get("/users/me", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { data, error: dbError } = await supabase
      .from("users")
      .select("*")
      .eq("email", req.user.email)
      .single();

    if (dbError) {
      if (dbError.code === "PGRST116") {
        return error(res, "User not found", 404);
      }
      return error(res, dbError.message, 500);
    }

    return success(res, data);
  } catch (err) {
    console.error("❌ GET /api/users/me error:", err.message);
    return error(res, "Failed to fetch user profile");
  }
});

// GET /api/users/check?email=X - Check if user exists by email
router.get("/users/check", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return error(res, "Email query parameter is required", 400);
    }

    const supabase = getServiceClient();
    const { data, error: dbError } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (dbError && dbError.code !== "PGRST116") {
      return error(res, dbError.message, 500);
    }

    return success(res, data || null);
  } catch (err) {
    console.error("❌ GET /api/users/check error:", err.message);
    return error(res, "Failed to check user");
  }
});

// POST /api/users - Create a new user record
router.post("/users", async (req, res) => {
  try {
    const userData = req.body;
    if (!userData || !userData.email) {
      return error(res, "User data with email is required", 400);
    }

    const supabase = getServiceClient();
    const { data, error: dbError } = await supabase
      .from("users")
      .insert(userData)
      .select();

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, data, "User created successfully", 201);
  } catch (err) {
    console.error("❌ POST /api/users error:", err.message);
    return error(res, "Failed to create user");
  }
});

// PUT /api/users/me/body-type - Update user body type
router.put("/users/me/body-type", async (req, res) => {
  try {
    const { bodyType } = req.body;
    if (!bodyType) {
      return error(res, "bodyType is required", 400);
    }

    const supabase = getServiceClient();

    // Look up user by email to get the user's id
    const { data: userData, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.email)
      .single();

    if (lookupError || !userData) {
      return error(res, "User not found", 404);
    }

    const { error: dbError } = await supabase
      .from("users")
      .update({ user_body_type: bodyType })
      .eq("id", userData.id);

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, null, "Body type updated");
  } catch (err) {
    console.error("❌ PUT /api/users/me/body-type error:", err.message);
    return error(res, "Failed to update body type");
  }
});

// PUT /api/users/me/push-token - Update push notification token
router.put("/users/me/push-token", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return error(res, "token is required", 400);
    }

    const supabase = getServiceClient();

    const { data: userData, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.email)
      .single();

    if (lookupError || !userData) {
      return error(res, "User not found", 404);
    }

    const { error: dbError } = await supabase
      .from("users")
      .update({ notification_id: token })
      .eq("id", userData.id);

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, null, "Push token updated");
  } catch (err) {
    console.error("❌ PUT /api/users/me/push-token error:", err.message);
    return error(res, "Failed to update push token");
  }
});

// GET /api/users/me/trips - Get user plans/trips
router.get("/users/me/trips", async (req, res) => {
  try {
    const supabase = getServiceClient();

    const { data: userData, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.email)
      .single();

    if (lookupError || !userData) {
      return error(res, "User not found", 404);
    }

    const { data, error: dbError } = await supabase
      .from("user_plans")
      .select("*")
      .eq("user_id", userData.id);

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, data || []);
  } catch (err) {
    console.error("❌ GET /api/users/me/trips error:", err.message);
    return error(res, "Failed to fetch user trips");
  }
});

// GET /api/messages - Get messages for authenticated user
router.get("/messages", async (req, res) => {
  try {
    const supabase = getServiceClient();

    const { data: userData, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.email)
      .single();

    if (lookupError || !userData) {
      return success(res, []);
    }

    const { data, error: dbError } = await supabase
      .from("messages")
      .select("*")
      .eq("user_id", userData.id)
      .order("created_at", { ascending: false });

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, data || []);
  } catch (err) {
    console.error("❌ GET /api/messages error:", err.message);
    return error(res, "Failed to fetch messages");
  }
});

// POST /api/messages - Create a message
router.post("/messages", async (req, res) => {
  try {
    const messageData = req.body;
    if (!messageData) {
      return error(res, "Message data is required", 400);
    }

    const supabase = getServiceClient();
    const { data, error: dbError } = await supabase
      .from("messages")
      .insert(messageData)
      .select();

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, data, "Message created", 201);
  } catch (err) {
    console.error("❌ POST /api/messages error:", err.message);
    return error(res, "Failed to create message");
  }
});

// DELETE /api/users/me - Delete user account (cascade: messages, personalization, users)
router.delete("/users/me", async (req, res) => {
  try {
    const supabase = getServiceClient();

    const { data: userData, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.email)
      .single();

    if (lookupError || !userData) {
      return error(res, "User not found", 404);
    }

    const userId = userData.id;
    console.log(`🗑️ Deleting account for user: ${userId}`);

    // Delete all associated data (order matters for foreign keys)
    // 1. Scale measurements (via scale_records)
    const { data: records } = await supabase
      .from("scale_records")
      .select("id")
      .eq("scale_user_id", userId);
    if (records && records.length > 0) {
      const recordIds = records.map((r) => r.id);
      await supabase.from("scale_measurements").delete().in("scale_record_id", recordIds);
    }

    // 2. Scale records
    await supabase.from("scale_records").delete().eq("scale_user_id", userId);

    // 3. Subscription events
    try { await supabase.from("subscription_events").delete().eq("user_id", userId); } catch (_) {}

    // 4. User goals
    try { await supabase.from("user_goals").delete().eq("user_id", userId); } catch (_) {}

    // 5. Devices
    await supabase.from("devices").delete().eq("user_id", userId);

    // 6. Log sessions
    try { await supabase.from("log_sessions").delete().eq("user_id", userId); } catch (_) {}

    // 7. Messages
    await supabase.from("messages").delete().eq("user_id", userId);

    // 8. Personalization
    await supabase.from("personalization").delete().eq("userid", userId);

    // 9. Delete the user record
    const { error: deleteError } = await supabase
      .from("users")
      .delete()
      .eq("id", userId);

    if (deleteError) {
      console.error("❌ Failed to delete user record:", deleteError);
      return error(res, deleteError.message, 500);
    }

    // 10. Delete Supabase auth user
    try {
      await supabase.auth.admin.deleteUser(userId);
      console.log("✅ Auth user deleted");
    } catch (authErr) {
      console.warn("⚠️ Failed to delete auth user (non-blocking):", authErr.message);
    }

    console.log(`✅ Account fully deleted: ${userId}`);
    return success(res, null, "Account deleted successfully");
  } catch (err) {
    console.error("❌ DELETE /api/users/me error:", err.message);
    return error(res, "Failed to delete account");
  }
});

module.exports = router;
