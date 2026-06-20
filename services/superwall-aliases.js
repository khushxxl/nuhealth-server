// Superwall alias → user mapping helpers.
//
// We learn a user's anonymous Superwall identifiers (Apple IDFV, appUserId)
// from the client and persist them so the webhook can resolve the owner of a
// purchase that was keyed against the alias instead of our users.id — which
// otherwise gets orphaned in pending_subscription_events. See the migration
// `supabase-superwall-aliases-migration.sql` for the rationale.

const { getServiceClient } = require("./supabase");

// "$SuperwallAlias:UUID" → "UUID"; trims and drops empties.
function normalizeAlias(raw) {
  if (typeof raw !== "string") return null;
  let a = raw.trim();
  if (!a) return null;
  if (a.startsWith("$SuperwallAlias:")) a = a.slice("$SuperwallAlias:".length);
  a = a.trim();
  return a.length ? a : null;
}

function cleanAliases(aliases) {
  const set = new Set();
  for (const raw of Array.isArray(aliases) ? aliases : []) {
    const a = normalizeAlias(raw);
    if (a) set.add(a);
  }
  return [...set];
}

/**
 * Record alias→user links. Best-effort: never throws (callers treat this as a
 * side effect, not a critical path). Skips our own user id (it's not an alias)
 * and refreshes last_seen on conflict.
 *
 * @param {string} userId
 * @param {string[]} aliases - raw client-supplied identifiers
 * @returns {Promise<number>} number of aliases written
 */
async function recordUserAliases(userId, aliases) {
  try {
    if (!userId) return 0;
    const db = getServiceClient();
    if (!db) return 0;

    // Don't store the user's own id as an "alias" — it adds no resolving power.
    const rows = cleanAliases(aliases)
      .filter((a) => a.toLowerCase() !== String(userId).toLowerCase())
      .map((alias_id) => ({
        alias_id,
        user_id: userId,
        last_seen: new Date().toISOString(),
      }));

    if (!rows.length) return 0;

    const { error } = await db
      .from("user_superwall_aliases")
      .upsert(rows, { onConflict: "alias_id" });

    if (error) {
      console.warn("[Aliases] recordUserAliases failed:", error.message);
      return 0;
    }
    return rows.length;
  } catch (err) {
    console.warn("[Aliases] recordUserAliases threw:", err.message);
    return 0;
  }
}

/**
 * Reverse-lookup: given one or more identifiers from a webhook, find the user
 * they map to. Matches case-insensitively. Returns the user_id or null.
 *
 * @param {string[]} aliases
 * @returns {Promise<string|null>}
 */
async function findUserIdByAliases(aliases) {
  try {
    const db = getServiceClient();
    if (!db) return null;
    const candidates = cleanAliases(aliases);
    if (!candidates.length) return null;

    // ilike match per candidate (handles the uppercase-IDFV vs lowercase mix).
    const orClause = candidates
      .map((a) => `alias_id.ilike.${a}`)
      .join(",");

    const { data, error } = await db
      .from("user_superwall_aliases")
      .select("user_id, last_seen")
      .or(orClause)
      .order("last_seen", { ascending: false })
      .limit(1);

    if (error) {
      console.warn("[Aliases] findUserIdByAliases failed:", error.message);
      return null;
    }
    return data && data.length ? data[0].user_id : null;
  } catch (err) {
    console.warn("[Aliases] findUserIdByAliases threw:", err.message);
    return null;
  }
}

module.exports = {
  normalizeAlias,
  cleanAliases,
  recordUserAliases,
  findUserIdByAliases,
};
