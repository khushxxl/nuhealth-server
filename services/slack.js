const axios = require("axios");

/**
 * Slack ops notifications.
 *
 * Two channels:
 *   - revenue → SLACK_REVENUE_WEBHOOK_URL  (subscription lifecycle)
 *   - reports → SLACK_REPORTS_WEBHOOK_URL  (BLE / WiFi / sync failures)
 *
 * If a category-specific URL isn't set we fall back to SLACK_WEBHOOK_URL so
 * single-channel deployments keep working without re-config. All sends are
 * fire-and-forget — failures never propagate to the caller, so an
 * unreachable Slack never breaks the user-facing flow that triggered the
 * notification.
 *
 * Optional: SLACK_ENV_LABEL ("prod" / "staging") prepends every message so
 * multi-env servers posting to the same channel can be told apart.
 */

const REVENUE_URL =
  process.env.SLACK_REVENUE_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
const REPORTS_URL =
  process.env.SLACK_REPORTS_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
const ENV_LABEL = process.env.SLACK_ENV_LABEL || "";
const warnedMissing = new Set();

// Map each event type to a category so the right webhook gets the post.
const EVENT_CATEGORY = {
  // ── Revenue ────────────────────────────────────────────────────────
  subscription_new: "revenue",
  subscription_renewed: "revenue",
  subscription_cancelled: "revenue",
  subscription_expired: "revenue",
  subscription_billing_issue: "revenue",
  subscription_paused: "revenue",

  // ── Operational reports ────────────────────────────────────────────
  ble_pairing_failed: "reports",
  wifi_setup_failed: "reports",
  scale_sync_failed: "reports",
  server_heartbeat: "reports",
  server_unhealthy: "reports",
};

const ICONS = {
  ble_pairing_failed: "🔵",
  wifi_setup_failed: "📡",
  scale_sync_failed: "⚖️",
  subscription_new: "💰",
  subscription_renewed: "🔁",
  subscription_cancelled: "⚠️",
  subscription_expired: "⌛",
  subscription_billing_issue: "🔴",
  subscription_paused: "⏸️",
  server_heartbeat: "💓",
  server_unhealthy: "🔴",
  generic: "ℹ️",
};

/**
 * Post a structured event to the ops channel.
 *
 * @param {Object} params
 * @param {string} params.type        Stable event key (e.g. "ble_pairing_failed").
 * @param {string} params.title       Human-readable headline.
 * @param {string} [params.reason]    What went wrong / why this fired.
 * @param {string} [params.userId]    Supabase user id (rendered as code).
 * @param {string} [params.email]     User email if available.
 * @param {Object} [params.details]   Free-form key/value rendered as fields.
 */
async function notify({ type, title, reason, userId, email, details }) {
  // Route to the right webhook based on the event category. Falls back to
  // the shared SLACK_WEBHOOK_URL if the category-specific one isn't set.
  const category = EVENT_CATEGORY[type] || "reports";
  const webhookUrl = category === "revenue" ? REVENUE_URL : REPORTS_URL;

  if (!webhookUrl) {
    const warnKey = category;
    if (!warnedMissing.has(warnKey)) {
      const envName =
        category === "revenue"
          ? "SLACK_REVENUE_WEBHOOK_URL"
          : "SLACK_REPORTS_WEBHOOK_URL";
      console.warn(
        `[Slack] ${envName} (or SLACK_WEBHOOK_URL fallback) not set — ${category} notifications disabled`,
      );
      warnedMissing.add(warnKey);
    }
    return;
  }

  const icon = ICONS[type] || ICONS.generic;
  const envSuffix = ENV_LABEL ? `  · _${ENV_LABEL}_` : "";

  // Build a compact Block Kit message. Header + the offending reason +
  // a fields grid of user/email/extras + a context line with timestamp.
  const fields = [];
  if (userId) fields.push({ type: "mrkdwn", text: `*User*\n\`${userId}\`` });
  if (email) fields.push({ type: "mrkdwn", text: `*Email*\n${email}` });
  if (details && typeof details === "object") {
    for (const [k, v] of Object.entries(details)) {
      if (v == null || v === "") continue;
      const valStr = typeof v === "string" ? v : JSON.stringify(v);
      // Slack mrkdwn fields cap at 2000 chars; clamp to be safe.
      const clipped = valStr.length > 500 ? valStr.slice(0, 497) + "..." : valStr;
      fields.push({ type: "mrkdwn", text: `*${k}*\n${clipped}` });
    }
  }

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${icon} *${title}*${envSuffix}`,
      },
    },
  ];

  if (reason) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Reason*\n${reason}`,
      },
    });
  }

  if (fields.length) {
    // Slack caps fields at 10 per section.
    for (let i = 0; i < fields.length; i += 10) {
      blocks.push({ type: "section", fields: fields.slice(i, i + 10) });
    }
  }

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `\`${type}\`  ·  ${new Date().toISOString()}` },
    ],
  });

  try {
    await axios.post(
      webhookUrl,
      { text: `${icon} ${title}`, blocks },
      { timeout: 5000 },
    );
  } catch (err) {
    // Don't surface errors back to callers — this is best-effort observability.
    console.warn("[Slack] notify failed:", err?.message || err);
  }
}

module.exports = { notify };
