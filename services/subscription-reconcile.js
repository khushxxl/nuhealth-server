/**
 * Subscription reconciliation — Superwall API is the source of truth.
 *
 * The `users.subscription_status` / `subscription_expires_at` columns are
 * reconciled from Superwall's alias-aware v3 subscriptions endpoint
 * (`GET /v3/users/{app_user_id}/subscriptions`). This module is the SOLE
 * writer of those columns: the webhook triggers a per-user reconcile rather
 * than writing the event payload directly, and a daily cron sweeps everyone to
 * catch drift (renewals, lapses, refunds, orphaned purchases).
 *
 * NOTE: client-side pro gating still runs on the on-device Superwall SDK
 * receipt — this DB truth is consumed server-side (e.g. the insights/scoring
 * pipeline), never as the client gate.
 */
const { isStatusPro } = require("./live-updates");

const API_KEY = process.env.SUPERWALL_API_KEY;
const APP_IDS = [
  process.env.SUPERWALL_APP_ID_IOS,
  process.env.SUPERWALL_APP_ID_ANDROID,
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tsMs = (v) => (v ? new Date(v).getTime() : null);

async function fetchSubs(userId, appId, tries = 0) {
  const url = `https://api.superwall.com/v3/users/${encodeURIComponent(
    userId,
  )}/subscriptions?application_id=${encodeURIComponent(appId)}`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
  } catch {
    return { ok: false, data: null };
  }
  // Respect the rate limiter with a bounded backoff.
  if (res.status === 429 && tries < 5) {
    const retryAfter = Number(res.headers.get("retry-after")) || 1.5 * (tries + 1);
    await sleep(retryAfter * 1000);
    return fetchSubs(userId, appId, tries + 1);
  }
  if (res.status !== 200) return { ok: false, status: res.status, data: null };
  const json = await res.json().catch(() => null);
  return { ok: true, data: (json && json.data) || [] };
}

/**
 * Alias-aware subscription state, merged across every supplied identifier
 * (user id + any Superwall aliases) and both platform application ids. Passing
 * the aliases as well as the user id means we still catch a purchase that lives
 * under an anonymous `$SuperwallAlias:` id that was never linked to the account.
 * Returns { reachable, pro, expiresAt, ... }.
 */
async function getApiSubscription(idOrIds) {
  if (!API_KEY || !APP_IDS.length) return { reachable: false };
  const ids = [
    ...new Set((Array.isArray(idOrIds) ? idOrIds : [idOrIds]).filter(Boolean)),
  ];
  let reachable = false;
  const raw = [];
  for (const id of ids) {
    for (const appId of APP_IDS) {
      const r = await fetchSubs(id, appId);
      if (r.ok) {
        reachable = true;
        if (r.data.length) raw.push(...r.data);
      }
    }
  }
  if (!reachable) return { reachable: false };

  // Dedupe subscriptions surfaced under more than one identifier.
  const seen = new Set();
  const subs = [];
  for (const s of raw) {
    const key = s.subscription_id || s.transaction_id || JSON.stringify(s);
    if (!seen.has(key)) {
      seen.add(key);
      subs.push(s);
    }
  }

  const active = subs.filter((s) => s.is_active === true || s.is_lifetime === true);
  const pro = active.length > 0;
  const expMs = active
    .map((s) => tsMs(s.expires_at))
    .filter((n) => n != null);
  return {
    reachable: true,
    pro,
    hasData: subs.length > 0,
    lifetime: active.some((s) => s.is_lifetime === true),
    expiresAt: pro && expMs.length ? new Date(Math.max(...expMs)).toISOString() : null,
    store: active[0]?.store || subs[0]?.store || null,
    product: active[0]?.product_id || null,
  };
}

/**
 * Reconcile a single user. `row` may be a bare id (string) or a row object
 * with the current subscription columns (avoids a re-read in the sweep).
 * Writes only when the pro-status or expiry actually changes, and leaves the
 * existing label on users who were already non-pro (preserves cancelled/etc.).
 */
async function reconcileUser(supabase, row, opts = {}) {
  let cur = typeof row === "string" ? null : row;
  const userId = typeof row === "string" ? row : row.id;

  if (!cur) {
    const { data } = await supabase
      .from("users")
      .select("id, subscription_status, subscription_expires_at")
      .eq("id", userId)
      .maybeSingle();
    cur = data || { id: userId, subscription_status: null, subscription_expires_at: null };
  }

  // Confirm against the user id AND any known Superwall aliases so a purchase
  // under an unlinked alias is never missed.
  const ids = [userId, ...(opts.extraIds || [])];
  const api = await getApiSubscription(ids);
  if (!api.reachable) return { userId, changed: false, reason: "unreachable" };

  const curStatus = cur.subscription_status ?? null;
  const curExp = cur.subscription_expires_at ?? null;
  let patch = null;

  if (api.pro) {
    const expChanged = tsMs(api.expiresAt) !== tsMs(curExp);
    if (curStatus !== "active" || expChanged) {
      patch = { subscription_status: "active", subscription_expires_at: api.expiresAt };
      if (api.store) patch.subscription_store = api.store;
    }
  } else if (isStatusPro(curStatus, curExp)) {
    // Was pro, API says not anymore → lapsed.
    patch = { subscription_status: "expired", subscription_expires_at: null };
  }

  if (!patch) return { userId, changed: false, pro: api.pro };
  const { error } = await supabase.from("users").update(patch).eq("id", userId);
  return { userId, changed: !error, pro: api.pro, patch, error: error?.message };
}

/**
 * Sweep every user through the API and reconcile. Returns a summary.
 */
async function reconcileAll(supabase, { concurrency = 8, onProgress } = {}) {
  const { data: users, error } = await supabase
    .from("users")
    .select("id, subscription_status, subscription_expires_at");
  if (error) throw error;

  const summary = {
    total: users.length,
    flippedToPro: 0,
    flippedToFree: 0,
    expiryRefreshed: 0,
    unchanged: 0,
    unreachable: 0,
    errors: 0,
  };

  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < users.length) {
        const row = users[i++];
        try {
          const r = await reconcileUser(supabase, row);
          if (r.reason === "unreachable") summary.unreachable++;
          else if (r.error) summary.errors++;
          else if (!r.changed) summary.unchanged++;
          else if (r.patch.subscription_status === "active" &&
                   row.subscription_status !== "active") summary.flippedToPro++;
          else if (r.patch.subscription_status === "expired") summary.flippedToFree++;
          else summary.expiryRefreshed++;
        } catch {
          summary.errors++;
        }
        done++;
        if (onProgress && done % 100 === 0) onProgress(done, users.length);
      }
    }),
  );
  return summary;
}

module.exports = { getApiSubscription, reconcileUser, reconcileAll };
