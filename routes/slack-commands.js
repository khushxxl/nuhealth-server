const express = require("express");
const router = express.Router();
const { gatherHealthStatus, formatUptime } = require("../services/health-check");

// NOTE: this endpoint is intentionally unauthenticated. The only command
// wired today is `/health`, which returns non-sensitive status data. Add
// signing-secret verification (Slack `X-Slack-Signature` v0 scheme) here
// before wiring any command that mutates state or reads user info.

/**
 * Slack sends slash command bodies as application/x-www-form-urlencoded.
 * Our server captures everything as raw text first, so we parse the form
 * manually here.
 */
function parseSlackForm(raw) {
  const params = new URLSearchParams(raw || "");
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

/**
 * POST /slack/commands
 *
 * Single endpoint that dispatches every Slack slash command we expose,
 * keyed by the `command` field in the form payload. Today only `/health`
 * is wired; new commands can hop into the switch below.
 */
router.post("/commands", async (req, res) => {
  const form = parseSlackForm(req.rawBody);
  const command = form.command;

  switch (command) {
    case "/health":
      return handleHealthCommand(req, res);
    default:
      return res.status(200).json({
        response_type: "ephemeral",
        text: `Unknown command: ${command}`,
      });
  }
});

async function handleHealthCommand(req, res) {
  try {
    const status = await gatherHealthStatus();
    const overall = status.status === "healthy" ? "✅" : "🔴";

    const fields = [
      {
        type: "mrkdwn",
        text: `*Database*\n${iconFor(status.services.database.status)} ${status.services.database.message}`,
      },
      {
        type: "mrkdwn",
        text: `*Redis*\n${iconFor(status.services.redis.status)} ${status.services.redis.message}`,
      },
      {
        type: "mrkdwn",
        text: `*Uptime*\n${formatUptime(status.uptimeSeconds)}`,
      },
      {
        type: "mrkdwn",
        text: `*Memory*\n${status.memoryMb} MB`,
      },
      {
        type: "mrkdwn",
        text: `*Environment*\n${status.environment}`,
      },
      {
        type: "mrkdwn",
        text: `*Node*\n${status.nodeVersion}`,
      },
    ];

    return res.status(200).json({
      response_type: "in_channel", // visible to everyone in the channel
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${overall} *Biyo server health: ${status.status}*  ·  checked in ${status.checkMs} ms`,
          },
        },
        { type: "section", fields },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `\`/health\`  ·  ${status.timestamp}`,
            },
          ],
        },
      ],
    });
  } catch (err) {
    console.error("[SlackCommands] /health failed:", err.message);
    return res.status(200).json({
      response_type: "ephemeral",
      text: `🔴 Health check threw: ${err.message}`,
    });
  }
}

function iconFor(status) {
  if (status === "healthy") return "✅";
  if (status === "skipped") return "➖";
  return "🔴";
}

module.exports = router;
