const express = require("express");
const router = express.Router();
const { getServiceClient } = require("../services/supabase");
const { success, error } = require("../utils/apiResponse");
const {
  isBodyscaleDeviceName,
  canonicaliseScaleName,
} = require("../config/deviceNames");

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

// POST /api/devices/scale - Register the BLE bodyscale for the authenticated
// user. Idempotent: if a bodyscale row already exists (matched by name
// containing "nubody" or "biyo"), it's returned unchanged. This is the
// server-side replacement for the three direct-from-client supabase inserts
// that previously ran in connect-devices, ble-scan and ble-connect.
router.post("/devices/scale", async (req, res) => {
  try {
    const { deviceName } = req.body || {};
    const supabase = getServiceClient();

    const { data: userData, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.email)
      .single();

    if (lookupError || !userData) return error(res, "User not found", 404);

    const { data: existing, error: existingError } = await supabase
      .from("devices")
      .select("id, device_name, device_information, created_at")
      .eq("user_id", userData.id);

    if (existingError) return error(res, existingError.message, 500);

    const alreadySaved = (existing || []).find((d) =>
      isBodyscaleDeviceName(d.device_name),
    );
    if (alreadySaved) {
      return success(res, { device: alreadySaved, created: false });
    }

    const storedName = canonicaliseScaleName(deviceName);
    const { data, error: insertError } = await supabase
      .from("devices")
      .insert({
        user_id: userData.id,
        device_name: storedName,
        device_information: [],
      })
      .select()
      .single();

    if (insertError) return error(res, insertError.message, 500);
    return success(res, { device: data, created: true });
  } catch (err) {
    console.error("❌ POST /api/devices/scale error:", err.message);
    return error(res, "Failed to register scale");
  }
});

// DELETE /api/devices/:id - Remove a device row by id. Verifies ownership
// against the authenticated user before deleting. Used by the device-removal
// flows in controlled-devices and all-device-page.
router.delete("/devices/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return error(res, "Device id is required", 400);

    const supabase = getServiceClient();
    const { data: userData, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.email)
      .single();

    if (lookupError || !userData) return error(res, "User not found", 404);

    const { data: device, error: findError } = await supabase
      .from("devices")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle();

    if (findError) return error(res, findError.message, 500);
    if (!device) return error(res, "Device not found", 404);
    if (String(device.user_id) !== String(userData.id)) {
      return error(res, "Forbidden", 403);
    }

    const { error: deleteError } = await supabase
      .from("devices")
      .delete()
      .eq("id", id);

    if (deleteError) return error(res, deleteError.message, 500);
    return success(res, { id });
  } catch (err) {
    console.error("❌ DELETE /api/devices/:id error:", err.message);
    return error(res, "Failed to delete device");
  }
});

// PUT /api/devices/scale/user-list - Update the scale device's user_list (and
// optionally member_list) for the authenticated user. The server finds the
// user's bodyscale row, applies the strategy, and writes. Replaces all the
// client-side "select then merge then update" device-userlist sites.
//
// Body: {
//   userList: string[],       // incoming list from BLE
//   memberList?: string[],    // optional incoming member list
//   strategy?: "merge" | "replace",  // default "merge"
//   includeCurrentUser?: boolean,    // default true — guarantees owner is in their own list
// }
router.put("/devices/scale/user-list", async (req, res) => {
  try {
    const {
      userList,
      memberList,
      strategy = "merge",
      includeCurrentUser = true,
    } = req.body || {};

    if (!Array.isArray(userList)) {
      return error(res, "userList array is required", 400);
    }
    if (strategy !== "merge" && strategy !== "replace") {
      return error(res, "strategy must be 'merge' or 'replace'", 400);
    }

    const supabase = getServiceClient();
    const { data: userData, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", req.user.email)
      .single();

    if (lookupError || !userData) return error(res, "User not found", 404);

    const { data: devices, error: devError } = await supabase
      .from("devices")
      .select("id, device_name, user_list, member_list")
      .eq("user_id", userData.id);

    if (devError) return error(res, devError.message, 500);

    const scaleDevice = (devices || []).find((d) =>
      isBodyscaleDeviceName(d.device_name),
    );
    if (!scaleDevice) {
      return success(res, { updated: false, reason: "no scale device" });
    }

    const ownerId = includeCurrentUser ? String(userData.id) : null;
    const existing = Array.isArray(scaleDevice.user_list)
      ? scaleDevice.user_list
      : [];

    const nextUserList =
      strategy === "merge"
        ? [...new Set([...existing, ...userList, ...(ownerId ? [ownerId] : [])])]
        : userList;

    const patch = { user_list: nextUserList };
    if (memberList !== undefined) patch.member_list = memberList;

    const { data, error: updateError } = await supabase
      .from("devices")
      .update(patch)
      .eq("id", scaleDevice.id)
      .select()
      .single();

    if (updateError) return error(res, updateError.message, 500);
    return success(res, { updated: true, device: data });
  } catch (err) {
    console.error("❌ PUT /api/devices/scale/user-list error:", err.message);
    return error(res, "Failed to update scale user list");
  }
});

module.exports = router;
