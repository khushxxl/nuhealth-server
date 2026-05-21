// Thin wrapper around posthog-node. We only need fire-and-forget capture for
// server-side events (paywall reminder sent, etc.) so this module exposes a
// single capture() that swallows errors and never throws.
let client = null;

function getClient() {
  if (client !== null) return client;

  const key = process.env.POSTHOG_API_KEY;
  if (!key) {
    // Not configured — every call becomes a no-op so callers don't have to
    // guard. Log once so it's obvious in prod when events go missing.
    if (!getClient._warned) {
      console.warn(
        "[PostHog] POSTHOG_API_KEY not set — server-side events disabled",
      );
      getClient._warned = true;
    }
    client = false;
    return false;
  }

  try {
    const { PostHog } = require("posthog-node");
    client = new PostHog(key, {
      host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
      flushAt: 1, // send immediately — these are low-volume events
    });
  } catch (err) {
    console.warn("[PostHog] Failed to init posthog-node:", err.message);
    client = false;
  }
  return client;
}

/**
 * Capture a server-side analytics event for a specific user.
 * @param {string} distinctId - Supabase user id (matches the client's identify())
 * @param {string} event - Event name
 * @param {Object} [properties] - Event properties
 */
function capture(distinctId, event, properties = {}) {
  const c = getClient();
  if (!c || !distinctId) return;
  try {
    c.capture({
      distinctId,
      event,
      properties,
    });
  } catch (err) {
    console.warn("[PostHog] capture failed:", err.message);
  }
}

async function shutdown() {
  const c = getClient();
  if (!c) return;
  try {
    await c.shutdown();
  } catch {
    // ignore
  }
}

module.exports = { capture, shutdown };
