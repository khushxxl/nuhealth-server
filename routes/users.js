const express = require("express");
const router = express.Router();
const { getServiceClient } = require("../services/supabase");
const { success, error } = require("../utils/apiResponse");
const {
  resolveSubscription,
  mapToUserUpdate,
  isStale,
} = require("../services/superwall");

// GET /api/users/me - Fetch authenticated user profile
//
// Opportunistically reconciles `subscription_*` columns against Superwall
// on a 5-min TTL. The Superwall call is bounded by a 3s timeout and
// fails open (returns stale DB row) so a third-party outage never
// blocks the request. Pass `?refresh_subscription=true` to bypass the
// TTL — useful immediately after a known purchase.
router.get("/users/me", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { data: user, error: dbError } = await supabase
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

    // Decide whether to reconcile with Superwall. Skip entirely if env
    // vars aren't configured (deploy hasn't been updated yet) so this
    // change is safe to deploy before secrets land.
    const forceRefresh = req.query.refresh_subscription === "true";
    const shouldSync =
      !!process.env.SUPERWALL_API_KEY &&
      (forceRefresh || isStale(user.subscription_synced_at));

    if (shouldSync) {
      try {
        const summary = await resolveSubscription(
          user.id,
          user.subscription_store,
        );
        const patch = mapToUserUpdate(summary);

        // Only write when we actually got fresh data. If Superwall has no
        // record of the user OR returned null status, leave the existing
        // row alone — the webhook may have correct state we don't want
        // to clobber with a 404.
        if (patch && patch.subscription_status) {
          const { data: updated, error: updateErr } = await supabase
            .from("users")
            .update(patch)
            .eq("id", user.id)
            .select()
            .single();

          if (updateErr) {
            console.warn(
              "[users/me] Superwall sync update failed:",
              updateErr.message,
            );
          } else if (updated) {
            return success(res, updated);
          }
        } else if (patch === null) {
          // Successful HTTP but no usable shape — bump the synced_at
          // timestamp anyway so we don't hammer Superwall on every /me
          // for users it doesn't know about (free / never-purchased).
          await supabase
            .from("users")
            .update({ subscription_synced_at: new Date().toISOString() })
            .eq("id", user.id);
        }
      } catch (syncErr) {
        // Belt-and-suspenders — resolveSubscription already catches its
        // own errors and returns null, but if anything bubbles up here
        // (DB layer, serialization), don't fail the /me call.
        console.warn("[users/me] Superwall sync failed:", syncErr.message);
      }
    }

    return success(res, user);
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

// PUT /api/users/me/push-token - Update push notification token + device info
router.put("/users/me/push-token", async (req, res) => {
  try {
    const { token, deviceOs, appVersion } = req.body;
    console.log("📲 [Push] Received token:", token?.substring(0, 40), "...", "for", req.user?.email, "| OS:", deviceOs, "| App:", appVersion);
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

    const updateFields = { notification_id: token };
    if (deviceOs) updateFields.device_os = deviceOs;
    if (appVersion) updateFields.app_version = appVersion;

    const { error: dbError } = await supabase
      .from("users")
      .update(updateFields)
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

// GET /api/users/me/notification-preferences - Get user notification preferences
router.get("/users/me/notification-preferences", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { data, error: dbErr } = await supabase
      .from("users")
      .select("live_updates_notifications")
      .eq("id", req.user.id)
      .single();

    if (dbErr) return error(res, dbErr.message, 500);

    return success(res, {
      liveUpdates: data?.live_updates_notifications ?? true,
    });
  } catch (err) {
    console.error("❌ GET /api/users/me/notification-preferences error:", err.message);
    return error(res, "Failed to fetch notification preferences");
  }
});

// PUT /api/users/me/notification-preferences - Update notification preferences
// Body: { liveUpdates: boolean }
router.put("/users/me/notification-preferences", async (req, res) => {
  try {
    const { liveUpdates } = req.body;
    if (typeof liveUpdates !== "boolean") {
      return error(res, "liveUpdates (boolean) is required", 400);
    }

    const supabase = getServiceClient();
    const { error: dbErr } = await supabase
      .from("users")
      .update({ live_updates_notifications: liveUpdates })
      .eq("id", req.user.id);

    if (dbErr) return error(res, dbErr.message, 500);

    return success(res, { liveUpdates });
  } catch (err) {
    console.error("❌ PUT /api/users/me/notification-preferences error:", err.message);
    return error(res, "Failed to update notification preferences");
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

// PUT /api/users/me/subscription — REMOVED.
//
// Previously this endpoint let the authenticated user set their own
// subscription_status to any value, which the client used to auto-promote
// to "active" whenever Superwall's local SDK said ACTIVE. That ended up
// granting Pro to ~70% of signups (sandbox flickers, cached entitlements,
// promo campaigns, etc. — none real purchases).
//
// Entitlement is now strictly server-driven:
//   - Superwall webhook (POST /webhooks/superwall) writes status on
//     verified purchase events.
//   - Webhooks that arrive before the user row exists land in
//     `pending_subscription_events`.
//   - POST /api/users/me/reconcile-subscription drains that table after
//     the user signs in, attributing real purchases to the correct user.
//
// Any client that needs to know Pro status reads `users.subscription_status`
// (server-set) rather than writing to it. Treat this comment as the
// historical record; do not re-add a client write endpoint here.
router.put("/users/me/subscription", (req, res) =>
  error(
    res,
    "Endpoint removed. Subscription status is server-managed via Superwall webhook.",
    410,
  ),
);

/**
 * POST /api/users/me/reconcile-subscription
 *
 * Drains the pending_subscription_events table for the authenticated user.
 *
 * Background: webhooks can arrive before a user has been identified with
 * Superwall (cold start, race with auth, or signup-after-purchase flow).
 * Those events get parked in `pending_subscription_events` keyed by the
 * Superwall alias / originalAppUserId. As soon as the client identifies the
 * user, it calls this endpoint so the server can replay those pending
 * events onto the user row and clear them out. Without this, paid users
 * stay "free" indefinitely.
 *
 * Idempotent — safe to call on every app foreground.
 */
router.post("/users/me/reconcile-subscription", async (req, res) => {
  try {
    const userId = req.user.id;
    const supabase = getServiceClient();
    if (!supabase) return error(res, "Database not configured", 500);

    // Build the candidate ID set to look up pending events under.
    //
    // Pre-auth purchases get webhooks keyed against Superwall's anonymous
    // identifier — typically Apple's `identifierForVendor` (an UPPERCASE
    // UUID), which never matches our lowercase Supabase user IDs. The
    // client passes those extra aliases in the body so we can drain them.
    //
    // We compare case-insensitively because Apple emits uppercase but
    // Supabase emits lowercase, and a few historical rows mix the two.
    const extra = Array.isArray(req.body?.aliases) ? req.body.aliases : [];
    const candidates = [userId, ...extra]
      .filter((v) => typeof v === "string" && v.length > 0)
      .map((v) => v.toLowerCase());

    // Match pending events keyed against any of our candidate IDs. Order
    // oldest → newest so terminal events (expiration, cancellation) win
    // over earlier ones if we have both in the queue.
    const orClauses = candidates
      .flatMap((id) => [
        `alias_id.ilike.${id}`,
        `original_app_user_id.ilike.${id}`,
      ])
      .join(",");

    const { data: pending, error: fetchErr } = await supabase
      .from("pending_subscription_events")
      .select("*")
      .or(orClauses)
      .order("created_at", { ascending: true });

    if (fetchErr) {
      console.error(
        "[Reconcile] Failed to fetch pending events:",
        fetchErr.message,
      );
      return error(res, "Failed to fetch pending subscription events", 500);
    }

    if (!pending || pending.length === 0) {
      return success(res, { reconciled: 0 });
    }

    // Reduce the pending event stream into a single user-row update.
    // Same per-event mapping as the webhook handler — kept in sync below.
    let userUpdate = {};
    for (const ev of pending) {
      const data = ev.raw_payload?.data || {};
      switch (ev.event_type) {
        case "initial_purchase":
          userUpdate = {
            ...userUpdate,
            subscription_status:
              ev.period_type === "TRIAL" ? "trialing" : "active",
            subscription_product_id: ev.product_id,
            subscription_expires_at: ev.expires_at || null,
            subscription_started_at:
              ev.purchased_at || new Date().toISOString(),
            subscription_store: ev.store,
            subscription_period_type: ev.period_type,
          };
          break;
        case "renewal":
          userUpdate = {
            ...userUpdate,
            subscription_status: "active",
            subscription_product_id: ev.product_id,
            subscription_expires_at: ev.expires_at || null,
            subscription_period_type: data.isTrialConversion
              ? "NORMAL"
              : ev.period_type,
          };
          break;
        case "cancellation":
          userUpdate = {
            ...userUpdate,
            subscription_status: "cancelled",
            subscription_cancel_reason: ev.cancel_reason,
          };
          break;
        case "uncancellation":
          userUpdate = {
            ...userUpdate,
            subscription_status: "active",
            subscription_cancel_reason: null,
          };
          break;
        case "expiration":
          userUpdate = {
            ...userUpdate,
            subscription_status: "expired",
            subscription_cancel_reason: ev.cancel_reason,
          };
          break;
        case "billing_issue":
          userUpdate = { ...userUpdate, subscription_status: "billing_issue" };
          break;
        case "subscription_paused":
          userUpdate = { ...userUpdate, subscription_status: "paused" };
          break;
        case "product_change":
          userUpdate = {
            ...userUpdate,
            subscription_product_id:
              data.newProductId || ev.product_id,
          };
          break;
        case "non_renewing_purchase":
          userUpdate = {
            ...userUpdate,
            subscription_status: "active",
            subscription_product_id: ev.product_id,
            subscription_started_at:
              ev.purchased_at || new Date().toISOString(),
          };
          break;
        default:
          // ignore unknown — webhook would have also ignored it
          break;
      }
    }

    if (Object.keys(userUpdate).length > 0) {
      const { error: updateErr } = await supabase
        .from("users")
        .update(userUpdate)
        .eq("id", userId);
      if (updateErr) {
        console.error(
          "[Reconcile] Failed to apply user update:",
          updateErr.message,
        );
        return error(res, "Failed to apply pending subscription", 500);
      }

      // Also mirror into the audit table so subscription_events stays the
      // single source of truth for analytics.
      try {
        const auditRows = pending.map((ev) => ({
          event_id: ev.event_id,
          event_type: ev.event_type,
          user_id: userId,
          product_id: ev.product_id,
          price: ev.price,
          store: ev.store,
          period_type: ev.period_type,
          expiration_at: ev.expires_at,
          raw_payload: ev.raw_payload,
        }));
        await supabase
          .from("subscription_events")
          .upsert(auditRows, { onConflict: "event_id" });
      } catch (auditErr) {
        console.warn(
          "[Reconcile] Failed to mirror audit rows:",
          auditErr.message,
        );
      }
    }

    // Always clear the processed pending rows so we don't re-apply them
    // on the next call.
    const pendingIds = pending.map((p) => p.event_id);
    await supabase
      .from("pending_subscription_events")
      .delete()
      .in("event_id", pendingIds);

    console.log(
      `✅ [Reconcile] Drained ${pending.length} pending events for user ${userId}`,
    );

    return success(res, {
      reconciled: pending.length,
      applied: userUpdate,
    });
  } catch (err) {
    console.error("❌ reconcile-subscription error:", err.message);
    return error(res, "Failed to reconcile subscription");
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
