// Server-side wrapper around the Superwall V2 REST API.
//
// We use this to opportunistically reconcile `users.subscription_*`
// columns against Superwall's view of the world whenever /me is called
// and the cached state is stale. This catches drift the webhook misses
// (cold-start race, pre-auth purchase orphaned in pending_events,
// on-device subscription that never produced a webhook, family share).
//
// The DB is the canonical store for the rest of the server because
// backend jobs (live updates, daily plan generation, slack notifications)
// have no device session and can't query Superwall in their hot path.
// This sync is the safety net that keeps the DB honest.

const ENDPOINT = "https://api.superwall.com/v2";

// 3 second wall clock cap on the Superwall call. /me must never block on
// a third-party outage — if we time out, the caller falls back to the
// cached DB row.
const TIMEOUT_MS = 3000;

// Skip the network call if we synced within this window.
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Fetch the user's subscription summary from Superwall.
 *
 * Returns null if:
 *   - Required env vars are missing (deploy misconfiguration)
 *   - User isn't found on the given application_id (try the other platform)
 *   - The API errors / times out
 *
 * Returns the parsed `user_subscription_summary` object on success. Schema:
 *   {
 *     has_active_subscription: boolean,
 *     subscription_status: "active" | "trialing" | "cancelled" | "expired" | ...,
 *     primary_product_id: string,
 *     primary_store: "APP_STORE" | "PLAY_STORE" | ...,
 *     first_purchase_date: string (ISO),
 *     expiration_date: string (ISO),
 *     ...
 *   }
 */
async function fetchSubscriptionSummary(appUserId, applicationId) {
  const apiKey = process.env.SUPERWALL_API_KEY;
  if (!apiKey || !applicationId) return null;

  const url = `${ENDPOINT}/users/${encodeURIComponent(appUserId)}/subscription-summary?application_id=${encodeURIComponent(applicationId)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    if (res.status === 404) {
      // User not found on this application_id — caller should try the
      // other platform's app id before giving up.
      return null;
    }
    if (!res.ok) {
      console.warn(
        `[Superwall] subscription-summary ${res.status} for ${appUserId} on ${applicationId}`,
      );
      return null;
    }
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn(
        `[Superwall] subscription-summary timed out for ${appUserId}`,
      );
    } else {
      console.warn(
        `[Superwall] subscription-summary error for ${appUserId}:`,
        err.message,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a user's Superwall subscription state across iOS + Android apps.
 * Tries the user's known store first (from `subscription_store` if set),
 * then falls back to the other platform. Returns the first non-null hit.
 */
async function resolveSubscription(appUserId, knownStore) {
  const iosAppId = process.env.SUPERWALL_APP_ID_IOS;
  const androidAppId = process.env.SUPERWALL_APP_ID_ANDROID;
  if (!iosAppId && !androidAppId) return null;

  // Order matters: hit the user's known platform first to halve API calls
  // for already-resolved users. Brand-new users default to iOS-first
  // because that's where most of our paying base is.
  const preferIos = knownStore !== "PLAY_STORE";
  const order = preferIos
    ? [iosAppId, androidAppId]
    : [androidAppId, iosAppId];

  for (const appId of order) {
    if (!appId) continue;
    const summary = await fetchSubscriptionSummary(appUserId, appId);
    if (summary && summary.has_active_subscription !== undefined) {
      return summary;
    }
  }
  return null;
}

/**
 * Map a Superwall subscription_summary response into our users-table
 * columns. Returns a partial-update object suitable for `.update()`.
 * Returns null if the response shape is unusable.
 */
function mapToUserUpdate(summary) {
  if (!summary) return null;

  // Superwall returns lowercase status strings (active/trialing/cancelled/
  // expired/billing_issue/paused). Our isPaidStatus helper already
  // accepts these, so we store them verbatim.
  const status = summary.subscription_status || null;

  return {
    subscription_status: status,
    subscription_product_id: summary.primary_product_id || null,
    subscription_expires_at: summary.expiration_date || null,
    subscription_started_at: summary.first_purchase_date || null,
    subscription_store: summary.primary_store || null,
    // `period_type` isn't a top-level field in the summary response; we
    // derive it: if status is "trialing", period is TRIAL, otherwise NORMAL.
    subscription_period_type:
      status === "trialing" ? "TRIAL" : status ? "NORMAL" : null,
    subscription_synced_at: new Date().toISOString(),
  };
}

/**
 * Decide whether the cached subscription state is stale enough to warrant
 * a Superwall round trip. Called by /me to skip the network call on
 * back-to-back requests.
 */
function isStale(syncedAt) {
  if (!syncedAt) return true;
  const last = new Date(syncedAt).getTime();
  if (Number.isNaN(last)) return true;
  return Date.now() - last > STALE_AFTER_MS;
}

module.exports = {
  resolveSubscription,
  mapToUserUpdate,
  isStale,
  STALE_AFTER_MS,
};
