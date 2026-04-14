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

// POST /api/devices/wearable - Register a wearable connection
router.post("/devices/wearable", async (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider) return error(res, "provider is required", 400);

    const supabase = getServiceClient();
    const { data: userData, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.email)
      .single();

    if (lookupError || !userData) return error(res, "User not found", 404);

    const deviceName = `wearable:${provider}`;

    // Upsert — if already exists, update connected_at
    const { data, error: dbError } = await supabase
      .from("devices")
      .upsert(
        {
          user_id: userData.id,
          device_name: deviceName,
          device_information: [{ provider, connected_at: new Date().toISOString(), last_sync_at: null, status: "active" }],
        },
        { onConflict: "user_id,device_name", ignoreDuplicates: false },
      )
      .select();

    if (dbError) return error(res, dbError.message, 500);
    return success(res, data?.[0] || null);
  } catch (err) {
    console.error("❌ POST /api/devices/wearable error:", err.message);
    return error(res, "Failed to register wearable");
  }
});

// DELETE /api/devices/wearable/:provider - Remove a wearable connection
router.delete("/devices/wearable/:provider", async (req, res) => {
  try {
    const { provider } = req.params;
    const supabase = getServiceClient();

    const { data: userData, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.email)
      .single();

    if (lookupError || !userData) return error(res, "User not found", 404);

    const { error: dbError } = await supabase
      .from("devices")
      .delete()
      .eq("user_id", userData.id)
      .eq("device_name", `wearable:${provider}`);

    if (dbError) return error(res, dbError.message, 500);
    return success(res, { removed: provider });
  } catch (err) {
    console.error("❌ DELETE /api/devices/wearable error:", err.message);
    return error(res, "Failed to remove wearable");
  }
});

// GET /api/devices/wearables - Get connected wearables only
router.get("/devices/wearables", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { data: userData, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.email)
      .single();

    if (lookupError || !userData) return success(res, []);

    const { data, error: dbError } = await supabase
      .from("devices")
      .select("device_name, device_information, created_at")
      .eq("user_id", userData.id)
      .like("device_name", "wearable:%");

    if (dbError) return error(res, dbError.message, 500);

    const wearables = (data || []).map((d) => ({
      provider: d.device_name.replace("wearable:", ""),
      connected_at: d.device_information?.[0]?.connected_at || d.created_at,
      last_sync_at: d.device_information?.[0]?.last_sync_at || null,
      status: d.device_information?.[0]?.status || "active",
    }));

    return success(res, wearables);
  } catch (err) {
    console.error("❌ GET /api/devices/wearables error:", err.message);
    return error(res, "Failed to fetch wearables");
  }
});

module.exports = router;
