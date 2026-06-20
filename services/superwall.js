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
  // Superwall REST returns "trial" for a free trial; normalize to "trialing"
  // so the DB has one canonical spelling (the webhook writes "trialing" too).
  const rawStatus = summary.subscription_status || null;
  const status = rawStatus === "trial" ? "trialing" : rawStatus;

  // "Valid through" timestamp for gating (`subscription_expires_at > now()`).
  // Superwall can return BOTH `expiration_date` and `next_renewal_date`, and on
  // a re-subscribe `expiration_date` can be a STALE PAST date (the prior cycle)
  // while `next_renewal_date` is the real future end. Picking the first non-null
  // (old behavior) stored the past date and wrongly gated an active user out.
  // Take the furthest-future of the two so an active/renewing sub keeps its real
  // end date; falls back to whichever single value exists.
  const expCandidates = [summary.expiration_date, summary.next_renewal_date]
    .map((d) => (d ? new Date(d).getTime() : NaN))
    .filter((n) => Number.isFinite(n));
  const expiresAt = expCandidates.length
    ? new Date(Math.max(...expCandidates)).toISOString()
    : null;

  return {
    subscription_status: status,
    subscription_product_id: summary.primary_product_id || null,
    subscription_expires_at: expiresAt,
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

/**
 * Authoritative "is this user actually subscribed?" check against Superwall,
 * used as a fallback when our DB row says non-pro. Superwall is the payment
 * authority, so an active subscription there is real even if our DB hasn't
 * caught up — TestFlight/sandbox testers whose webhook keyed against a
 * $SuperwallAlias, or the window right after a purchase before the webhook +
 * /me reconcile land.
 *
 * Heals the DB on a confirmed-active hit so subsequent (cached) checks are
 * fast. No-ops (returns false) when SUPERWALL_API_KEY / app IDs aren't
 * configured, or on any error/timeout — the caller keeps its DB verdict.
 *
 * Optionally pass `aliases` — the client's Superwall identifiers (the
 * anonymous IDFV / appUserId). Pre-auth purchases (bought before identify()
 * ran) get recorded by Superwall against that anonymous alias, NOT our
 * users.id, so a lookup by users.id alone returns "no active sub" for a real
 * paying user. We try the user's id first, then each alias, and heal the DB
 * row (keyed by users.id) on the first confirmed-active hit.
 *
 * @param {object} supabase - service-role client
 * @param {string} userId
 * @param {string[]} [aliases] - extra Superwall identifiers to try
 * @returns {Promise<boolean>}
 */
async function verifyActiveViaSuperwall(supabase, userId, aliases = []) {
  try {
    // De-duped candidate list: our user id first (cheapest, most likely for
    // already-reconciled users), then any client-supplied aliases.
    const candidates = [...new Set(
      [userId, ...(Array.isArray(aliases) ? aliases : [])].filter(
        (v) => typeof v === "string" && v.length > 0,
      ),
    )];

    let summary = null;
    for (const candidate of candidates) {
      const hit = await resolveSubscription(candidate, null);
      if (hit?.has_active_subscription) {
        summary = hit;
        break;
      }
    }

    if (!summary?.has_active_subscription) return false;
    const patch = mapToUserUpdate(summary);
    if (patch?.subscription_status && supabase) {
      await supabase.from("users").update(patch).eq("id", userId);
    }
    return true;
  } catch (err) {
    console.warn("[Superwall] verifyActiveViaSuperwall failed:", err.message);
    return false;
  }
}

module.exports = {
  resolveSubscription,
  mapToUserUpdate,
  isStale,
  STALE_AFTER_MS,
  verifyActiveViaSuperwall,
};
