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
    console.log("📲 [Push] Received token:", token?.substring(0, 40), "...", "for", req.user?.email);
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

    // 10. Delete Supabase auth user (use auth UUID from JWT, not users table ID)
    const authUserId = req.user.id;
    console.log(`🗑️ Deleting auth user: ${authUserId}`);
    const { data: authDeleteData, error: authDeleteError } =
      await supabase.auth.admin.deleteUser(authUserId);
    if (authDeleteError) {
      console.error("⚠️ Failed to delete auth user:", authDeleteError);
    } else {
      console.log("✅ Auth user deleted:", authDeleteData);
    }

    console.log(`✅ Account fully deleted: ${userId}`);
    return success(res, null, "Account deleted successfully");
  } catch (err) {
    console.error("❌ DELETE /api/users/me error:", err.message);
    return error(res, "Failed to delete account");
  }
});

// PUT /api/users/me/subscription - Update user subscription status
router.put("/users/me/subscription", async (req, res) => {
  try {
    const {
      subscription_status,
      subscription_product_id,
      subscription_expires_at,
      subscription_started_at,
      subscription_store,
      subscription_period_type,
      subscription_cancel_reason,
    } = req.body;

    if (!subscription_status) {
      return error(res, "subscription_status is required", 400);
    }

    const supabase = getServiceClient();
    const updateData = {
      subscription_status,
      ...(subscription_product_id !== undefined && { subscription_product_id }),
      ...(subscription_expires_at !== undefined && { subscription_expires_at }),
      ...(subscription_started_at !== undefined && { subscription_started_at }),
      ...(subscription_store !== undefined && { subscription_store }),
      ...(subscription_period_type !== undefined && { subscription_period_type }),
      ...(subscription_cancel_reason !== undefined && { subscription_cancel_reason }),
    };

    const { data, error: dbError } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", req.user.id)
      .select()
      .single();

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, data);
  } catch (err) {
    console.error("❌ PUT /api/users/me/subscription error:", err.message);
    return error(res, "Failed to update subscription status");
  }
});

// GET /api/users/merged-user-list?userId=X - Get merged user_list from all devices sharing the same scale
// Finds all devices whose user_list contains this userId, then merges all user_lists into one deduplicated array
router.get("/users/merged-user-list", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return error(res, "userId query parameter is required", 400);
    }

    const supabase = getServiceClient();

    // Get all devices that have a user_list containing this userId
    const { data: devices, error: dbError } = await supabase
      .from("devices")
      .select("user_list")
      .not("user_list", "is", null);

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    // Filter to devices whose user_list includes this userId, then merge all lists
    const merged = new Set();
    (devices || []).forEach((d) => {
      if (Array.isArray(d.user_list) && d.user_list.includes(userId)) {
        d.user_list.forEach((id) => merged.add(id));
      }
    });

    return success(res, [...merged]);
  } catch (err) {
    console.error("❌ GET /api/users/merged-user-list error:", err.message);
    return error(res, "Failed to fetch merged user list");
  }
});

// POST /api/devices/sync-scale-user-list - Sync user_list across all bodyscale devices owned by users in the list
// When user B syncs and the scale has [A, B], this updates A's device record too
router.post("/devices/sync-scale-user-list", async (req, res) => {
  try {
    const { userList } = req.body;
    if (!userList || !Array.isArray(userList) || userList.length === 0) {
      return error(res, "userList array is required", 400);
    }

    const supabase = getServiceClient();

    // Find all bodyscale devices owned by ANY user in the list
    const { data: devices, error: findError } = await supabase
      .from("devices")
      .select("id, user_id, device_name, user_list")
      .in("user_id", userList);

    if (findError) {
      return error(res, findError.message, 500);
    }

    // Filter to bodyscale devices only
    const bodyscaleDevices = (devices || []).filter((d) => {
      const name = (d.device_name || "").toLowerCase();
      return name.includes("nubody") || name.includes("biyo");
    });

    if (bodyscaleDevices.length === 0) {
      return success(res, { updated: 0 }, "No bodyscale devices found");
    }

    // MERGE incoming list with each device's existing list (union, never shrink)
    // This prevents a stale [A] call from overwriting a correct [A, B]
    let updated = 0;
    for (const device of bodyscaleDevices) {
      const existing = Array.isArray(device.user_list) ? device.user_list : [];
      const merged = [...new Set([...existing, ...userList])];
      const existingSorted = [...existing].sort();
      const mergedSorted = [...merged].sort();
      // Only update if the merged list differs from existing
      if (JSON.stringify(existingSorted) !== JSON.stringify(mergedSorted)) {
        const { error: updateError } = await supabase
          .from("devices")
          .update({ user_list: merged })
          .eq("id", device.id);

        if (updateError) {
          console.error(`⚠️ Failed to update device ${device.id}:`, updateError.message);
        } else {
          updated++;
        }
      }
    }

    console.log(`✅ Merged user_list [${userList.join(", ")}] across ${updated} device(s)`);
    return success(res, { updated });
  } catch (err) {
    console.error("❌ POST /api/devices/sync-scale-user-list error:", err.message);
    return error(res, "Failed to sync scale user list");
  }
});

// POST /api/devices/clear-scale-users - Clear user_list on all bodyscale devices owned by the given user IDs
router.post("/devices/clear-scale-users", async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return error(res, "userIds array is required", 400);
    }

    const supabase = getServiceClient();

    // Find all bodyscale devices owned by these users
    const { data: devices, error: findError } = await supabase
      .from("devices")
      .select("id, user_id, device_name")
      .in("user_id", userIds);

    if (findError) {
      return error(res, findError.message, 500);
    }

    // Filter to bodyscale devices only (name contains "nubody" or "biyo")
    const bodyscaleDevices = (devices || []).filter((d) => {
      const name = (d.device_name || "").toLowerCase();
      return name.includes("nubody") || name.includes("biyo");
    });

    if (bodyscaleDevices.length === 0) {
      return success(res, { cleared: 0 }, "No bodyscale devices found");
    }

    const deviceIds = bodyscaleDevices.map((d) => d.id);

    const { error: updateError } = await supabase
      .from("devices")
      .update({ user_list: [] })
      .in("id", deviceIds);

    if (updateError) {
      return error(res, updateError.message, 500);
    }

    console.log(`✅ Cleared user_list on ${deviceIds.length} bodyscale device(s) for users: ${userIds.join(", ")}`);
    return success(res, { cleared: deviceIds.length });
  } catch (err) {
    console.error("❌ POST /api/devices/clear-scale-users error:", err.message);
    return error(res, "Failed to clear scale users");
  }
});

module.exports = router;
