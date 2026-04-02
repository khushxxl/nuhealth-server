const express = require("express");
const router = express.Router();
const { getServiceClient } = require("../services/supabase");

/**
 * POST /webhooks/superwall
 *
 * Receives Superwall subscription lifecycle events and updates
 * the user's subscription state in the database.
 *
 * No auth required — Superwall sends these server-to-server.
 * Idempotency is handled via event.data.id.
 */
router.post("/superwall", async (req, res) => {
  // Return 200 immediately (best practice — process async)
  res.status(200).json({ received: true });

  try {
    const event = req.body;
    const eventType = event?.type;
    const eventData = event?.data;

    if (!eventType || !eventData) {
      console.error("⚠️ [Webhook] Invalid payload — missing type or data");
      return;
    }

    console.log(`📩 [Webhook] Superwall event: ${eventType}`, {
      eventId: eventData.id,
      productId: eventData.productId,
      environment: eventData.environment,
      originalAppUserId: eventData.originalAppUserId,
      price: eventData.price,
      periodType: eventData.periodType,
    });

    // Log sandbox events but process them normally
    if (eventData.environment === "SANDBOX") {
      console.log("🧪 [Webhook] Sandbox event — processing normally");
    }

    const supabase = getServiceClient();
    if (!supabase) {
      console.error("❌ [Webhook] Supabase client not available");
      return;
    }

    // Resolve the app user ID from Superwall's originalAppUserId
    // Format: "$SuperwallAlias:UUID" or just a UUID
    let appUserId = eventData.originalAppUserId;
    if (!appUserId) {
      console.warn("⚠️ [Webhook] No originalAppUserId — cannot update user");
      return;
    }

    // Strip Superwall alias prefix if present
    if (appUserId.startsWith("$SuperwallAlias:")) {
      appUserId = appUserId.replace("$SuperwallAlias:", "");
    }

    // Determine subscription state based on event type
    let subscriptionUpdate = {};

    switch (eventType) {
      case "initial_purchase":
        subscriptionUpdate = {
          subscription_status:
            eventData.periodType === "TRIAL" ? "trialing" : "active",
          subscription_product_id: eventData.productId,
          subscription_expires_at: eventData.expirationAt
            ? new Date(eventData.expirationAt).toISOString()
            : null,
          subscription_started_at: eventData.purchasedAt
            ? new Date(eventData.purchasedAt).toISOString()
            : new Date().toISOString(),
          subscription_store: eventData.store,
          subscription_period_type: eventData.periodType,
        };
        console.log(
          `✅ [Webhook] Initial purchase — status: ${subscriptionUpdate.subscription_status}`,
        );
        break;

      case "renewal":
        subscriptionUpdate = {
          subscription_status: "active",
          subscription_product_id: eventData.productId,
          subscription_expires_at: eventData.expirationAt
            ? new Date(eventData.expirationAt).toISOString()
            : null,
          subscription_period_type: eventData.periodType,
        };
        if (eventData.isTrialConversion) {
          subscriptionUpdate.subscription_period_type = "NORMAL";
          console.log("✅ [Webhook] Trial converted to paid subscription");
        } else {
          console.log("✅ [Webhook] Subscription renewed");
        }
        break;

      case "cancellation":
        subscriptionUpdate = {
          subscription_status: "cancelled",
          subscription_cancel_reason: eventData.cancelReason,
        };
        console.log(
          `⚠️ [Webhook] Subscription cancelled — reason: ${eventData.cancelReason}`,
        );
        break;

      case "uncancellation":
        subscriptionUpdate = {
          subscription_status: "active",
          subscription_cancel_reason: null,
        };
        console.log("✅ [Webhook] Subscription reactivated");
        break;

      case "expiration":
        subscriptionUpdate = {
          subscription_status: "expired",
          subscription_cancel_reason:
            eventData.expirationReason || eventData.cancelReason,
        };
        console.log(
          `⚠️ [Webhook] Subscription expired — reason: ${eventData.expirationReason}`,
        );
        break;

      case "billing_issue":
        subscriptionUpdate = {
          subscription_status: "billing_issue",
        };
        console.log("⚠️ [Webhook] Billing issue — payment failed");
        break;

      case "product_change":
        subscriptionUpdate = {
          subscription_product_id:
            eventData.newProductId || eventData.productId,
        };
        console.log(
          `🔄 [Webhook] Product changed to: ${eventData.newProductId}`,
        );
        break;

      case "subscription_paused":
        subscriptionUpdate = {
          subscription_status: "paused",
        };
        console.log("⏸️ [Webhook] Subscription paused");
        break;

      case "non_renewing_purchase":
        subscriptionUpdate = {
          subscription_status: "active",
          subscription_product_id: eventData.productId,
          subscription_started_at: eventData.purchasedAt
            ? new Date(eventData.purchasedAt).toISOString()
            : new Date().toISOString(),
        };
        console.log("✅ [Webhook] Non-renewing purchase");
        break;

      default:
        console.log(`ℹ️ [Webhook] Unhandled event type: ${eventType}`);
        return;
    }

    // Update the user's subscription state in the database
    if (Object.keys(subscriptionUpdate).length > 0) {
      // Try to find user by ID directly
      const { data: user, error: findError } = await supabase
        .from("users")
        .select("id")
        .eq("id", appUserId)
        .maybeSingle();

      if (findError || !user) {
        console.warn(
          `⚠️ [Webhook] User not found — ID: ${appUserId}, original: ${eventData.originalAppUserId}`,
        );

        // Store as pending for later resolution when user opens app and identify() links their alias
        try {
          await supabase.from("pending_subscription_events").upsert(
            {
              event_id: eventData.id,
              event_type: eventType,
              original_app_user_id: eventData.originalAppUserId,
              alias_id: appUserId,
              product_id: eventData.productId,
              store: eventData.store,
              period_type: eventData.periodType,
              price: eventData.price,
              expires_at: eventData.expirationAt
                ? new Date(eventData.expirationAt).toISOString()
                : null,
              purchased_at: eventData.purchasedAt
                ? new Date(eventData.purchasedAt).toISOString()
                : null,
              cancel_reason:
                eventData.cancelReason || eventData.expirationReason || null,
              raw_payload: event,
            },
            { onConflict: "event_id" },
          );
          console.log(
            `📦 [Webhook] Stored as pending event for later resolution`,
          );
        } catch (pendingErr) {
          console.error(
            "❌ [Webhook] Failed to store pending event:",
            pendingErr.message,
          );
        }
        return;
      }

      const { error: updateError } = await supabase
        .from("users")
        .update(subscriptionUpdate)
        .eq("id", appUserId);

      if (updateError) {
        console.error(
          "❌ [Webhook] Failed to update subscription:",
          updateError,
        );
      } else {
        console.log(
          `✅ [Webhook] Updated user ${appUserId} subscription:`,
          subscriptionUpdate,
        );
      }
    }

    // Store raw webhook event for audit/debugging
    try {
      await supabase.from("subscription_events").insert({
        event_id: eventData.id,
        event_type: eventType,
        user_id: appUserId,
        product_id: eventData.productId,
        price: eventData.price,
        proceeds: eventData.proceeds,
        currency_code: eventData.currencyCode,
        store: eventData.store,
        environment: eventData.environment,
        period_type: eventData.periodType,
        transaction_id: eventData.transactionId,
        original_transaction_id: eventData.originalTransactionId,
        expiration_at: eventData.expirationAt
          ? new Date(eventData.expirationAt).toISOString()
          : null,
        raw_payload: event,
      });
    } catch (auditErr) {
      // Non-blocking — audit table might not exist yet
      console.warn(
        "⚠️ [Webhook] Failed to store audit event:",
        auditErr.message,
      );
    }
  } catch (err) {
    console.error("❌ [Webhook] Unhandled error:", err);
  }
});

/**
 * POST /webhooks/junction
 *
 * Receives Junction (Vital) wearable data events.
 * Phase 1: Log only — no DB writes.
 */
router.post("/junction", async (req, res) => {
  console.log(`📩 [Junction Webhook] Received request`);
  console.log(`📩 [Junction Webhook] Full payload:`, JSON.stringify(req.body, null, 2));
  res.status(200).json({ received: true });

  try {
    const event = req.body;
    console.log(`📩 [Junction Webhook] Event type: ${event.event_type}`, {
      userId: event.user_id,
      clientUserId: event.client_user_id,
      data: event.data ? Object.keys(event.data) : "no data",
    });

    // Phase 2 will add Supabase persistence here
  } catch (err) {
    console.error("❌ [Junction Webhook] Error:", err.message);
  }
});

module.exports = router;
