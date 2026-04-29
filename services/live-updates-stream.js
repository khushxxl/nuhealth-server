/**
 * Realtime live updates over Server-Sent Events.
 *
 * Architecture:
 *   - Each server instance keeps an in-memory map of locally-connected SSE clients.
 *   - When createUpdate() runs anywhere, it calls pushToUser() which PUBLISHES to a
 *     Redis pub/sub channel.
 *   - Every server instance has a SUBSCRIBER attached to that channel; the matching
 *     instance(s) write the SSE event to their local clients.
 *
 * This means:
 *   - Single instance: works (publish → same instance subscriber → local write)
 *   - Multiple instances: works (any instance can produce, target instance receives)
 *   - BullMQ workers: work (they share the process and use the same publisher)
 */

const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || null;
const CHANNEL = "live-updates";

// Local SSE connections (per server process)
const connections = new Map(); // userId -> Set<{ res, id }>
let connId = 0;

// Redis publisher / subscriber clients (lazy)
let publisher = null;
let subscriber = null;
let redisReady = false;

function initRedisIfNeeded() {
  if (!REDIS_URL || publisher) return;

  try {
    publisher = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    subscriber = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

    subscriber.on("connect", () => {
      redisReady = true;
      console.log("📡 [LiveStream] Redis pub/sub connected");
    });
    subscriber.on("error", (err) =>
      console.warn("[LiveStream] Subscriber error:", err.message),
    );
    publisher.on("error", (err) =>
      console.warn("[LiveStream] Publisher error:", err.message),
    );

    subscriber.subscribe(CHANNEL, (err) => {
      if (err) {
        console.error("[LiveStream] Subscribe failed:", err.message);
        return;
      }
      console.log(`📡 [LiveStream] Subscribed to "${CHANNEL}"`);
    });

    subscriber.on("message", (channel, raw) => {
      if (channel !== CHANNEL) return;
      try {
        const { userId, event, data } = JSON.parse(raw);
        writeToLocalConnections(userId, event, data);
      } catch (err) {
        console.warn("[LiveStream] Bad pub/sub payload:", err.message);
      }
    });
  } catch (err) {
    console.warn("[LiveStream] Redis init failed:", err.message);
    publisher = null;
    subscriber = null;
  }
}

function writeToLocalConnections(userId, event, data) {
  const set = connections.get(userId);
  if (!set || set.size === 0) return 0;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let delivered = 0;

  for (const { res } of set) {
    try {
      res.write(payload);
      delivered += 1;
    } catch {
      // client gone; cleanup runs via close handler
    }
  }
  if (delivered > 0) {
    console.log(`📡 [LiveStream] Delivered "${event}" to ${delivered} local connection(s) for ${userId}`);
  }
  return delivered;
}

// ─── Public API ───────────────────────────────────────────────────────────────

function addConnection(userId, res) {
  connId += 1;
  const entry = { res, id: connId };

  if (!connections.has(userId)) {
    connections.set(userId, new Set());
  }
  connections.get(userId).add(entry);

  console.log(
    `📡 [LiveStream] +1 connection for ${userId} (total: ${connections.get(userId).size})`,
  );

  return () => {
    const set = connections.get(userId);
    if (set) {
      set.delete(entry);
      if (set.size === 0) connections.delete(userId);
    }
    console.log(`📡 [LiveStream] -1 connection for ${userId}`);
  };
}

/**
 * Push an event to a user. Goes through Redis pub/sub if available so that any
 * server instance with the user's SSE connection can deliver it. Falls back to
 * direct in-process delivery if Redis is not configured.
 */
async function pushToUser(userId, event, data) {
  initRedisIfNeeded();

  if (publisher) {
    try {
      await publisher.publish(CHANNEL, JSON.stringify({ userId, event, data }));
      return;
    } catch (err) {
      console.warn(
        "[LiveStream] Publish failed, falling back to local:",
        err.message,
      );
    }
  }

  // No Redis (local dev) → write directly to local connections
  writeToLocalConnections(userId, event, data);
}

// Eager init on require if REDIS_URL is set
initRedisIfNeeded();

module.exports = { addConnection, pushToUser };
