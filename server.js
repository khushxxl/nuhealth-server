// Load environment variables from .env file
require("dotenv").config();

const express = require("express");
const { PORT } = require("./config/constants");
const { createBodyParser } = require("./middleware/bodyParser");
const { createLogger } = require("./middleware/logger");
const {
  createErrorHandler,
  createNotFoundHandler,
} = require("./middleware/errorHandler");
const deviceRoutes = require("./routes/device");
const recordRoutes = require("./routes/record");
const { getSupabaseClient } = require("./services/supabase");
const { OPENAI_API_KEY } = require("./config/constants");

const app = express();

// Capture raw body as text first, then parse JSON manually
// This allows us to handle malformed JSON gracefully
app.use(express.text({ type: "*/*", limit: "10mb" }));

// Custom JSON parsing middleware
app.use((req, res, next) => {
  // Store raw body (express.text() sets req.body as string)
  req.rawBody = (typeof req.body === "string" ? req.body : "") || "";

  // Only try to parse JSON if content-type suggests it or body looks like JSON
  const contentType = req.headers["content-type"] || "";
  const isJsonContentType = contentType.includes("application/json");
  const bodyStr = typeof req.body === "string" ? req.body : "";
  const looksLikeJson =
    bodyStr &&
    (bodyStr.trim().startsWith("{") || bodyStr.trim().startsWith("["));

  if (isJsonContentType || looksLikeJson) {
    if (!bodyStr || bodyStr.trim() === "") {
      req.body = {};
      return next();
    }

    try {
      req.body = JSON.parse(bodyStr);
    } catch (err) {
      console.log("⚠️  JSON Parse Error - attempting recovery");
      console.log("Error:", err.message);
      console.log("Raw body (first 500 chars):", bodyStr.substring(0, 500));

      // Try to extract JSON object from mixed content
      const jsonMatch = bodyStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          req.body = JSON.parse(jsonMatch[0]);
          console.log("✅ Successfully extracted JSON from mixed content");
        } catch (e) {
          console.log("⚠️  Could not extract valid JSON, using empty body");
          req.body = {};
        }
      } else {
        console.log("⚠️  No JSON object found, using empty body");
        req.body = {};
      }
    }
  } else {
    // Not JSON content, set empty object
    req.body = {};
  }

  next();
});

// Logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log("\n" + "=".repeat(80));
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  console.log("=".repeat(80));
  console.log("\n📋 Headers:");
  Object.entries(req.headers).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });

  // Log raw body if present
  if (req.rawBody && req.rawBody.length > 0) {
    console.log("\n📥 Raw Body:");
    const rawBodyStr =
      typeof req.rawBody === "string"
        ? req.rawBody
        : req.rawBody.toString("utf8");
    console.log(`  Length: ${rawBodyStr.length} bytes`);
    const bodyPreview =
      rawBodyStr.length > 500
        ? rawBodyStr.substring(0, 500) + "... (truncated)"
        : rawBodyStr;
    console.log(`  Content: ${bodyPreview}`);
    // Show first 100 chars in hex for debugging
    if (rawBodyStr.length > 0) {
      const hexPreview = Buffer.from(
        rawBodyStr.substring(0, 100),
        "utf8"
      ).toString("hex");
      console.log(`  Hex (first 100): ${hexPreview}`);
    }
  }

  // Log parsed body if present
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("\n📥 Parsed Body:");
    console.log(JSON.stringify(req.body, null, 2));
  } else if (req.method === "POST" && !req.rawBody) {
    console.log("\n📥 Body: (empty or not provided)");
  }

  next();
});

// Health check endpoint with database/service checks
app.get("/health", async (req, res) => {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      server: {
        status: "healthy",
        message: "Server is running",
      },
      database: {
        status: "unknown",
        message: "Not checked",
      },
      openai: {
        status: "unknown",
        message: "Not checked",
      },
    },
  };

  let overallHealthy = true;

  // Check Supabase database connection
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      // Perform a simple query to check database connectivity
      const { data, error } = await supabase
        .from("scale_records")
        .select("id")
        .limit(1);

      if (error) {
        health.services.database = {
          status: "unhealthy",
          message: `Database connection failed: ${error.message}`,
        };
        overallHealthy = false;
      } else {
        health.services.database = {
          status: "healthy",
          message: "Database connection successful",
        };
      }
    } catch (err) {
      health.services.database = {
        status: "unhealthy",
        message: `Database check error: ${err.message}`,
      };
      overallHealthy = false;
    }
  } else {
    health.services.database = {
      status: "unhealthy",
      message: "Supabase client not initialized",
    };
    overallHealthy = false;
  }

  // Check OpenAI service configuration
  if (OPENAI_API_KEY) {
    health.services.openai = {
      status: "healthy",
      message: "OpenAI API key configured",
    };
  } else {
    health.services.openai = {
      status: "degraded",
      message: "OpenAI API key not configured (optional service)",
    };
    // OpenAI is optional, so we don't mark overall as unhealthy
  }

  // Set overall status
  health.status = overallHealthy ? "healthy" : "unhealthy";

  // Return appropriate HTTP status code
  const statusCode = overallHealthy ? 200 : 503;

  res.status(statusCode).json(health);
});

// VENDOR PATTERN: Device POSTs to /devices/claim/lefu/wifi/torre/register
app.post("/devices/claim/lefu/wifi/torre/register", (req, res) => {
  console.log("🔧 Torre Device Registration (via /devices/claim path)");

  const response = {
    errorCode: 0,
    text: "Register success",
    data: {
      nowTime: Date.now(),
      unit: 0,
    },
  };

  console.log("\n📤 Response:");
  console.log(JSON.stringify(response, null, 2));
  console.log("=".repeat(80) + "\n");

  res.set({
    "Content-Type": "application/json",
    Connection: "close",
  });

  res.status(200).json(response);
});

// VENDOR PATTERN: Device POSTs to /devices/claim/lefu/wifi/torre/config
app.post("/devices/claim/lefu/wifi/torre/config", (req, res) => {
  console.log("⚙️  Torre Device Configuration Sync (via /devices/claim path)");

  const now = Date.now();
  const response = {
    errorCode: 0,
    text: "Get config info success",
    data: {
      nowTime: now,
      now: now,
      nowTimeSecond: Math.floor(now / 1000),
      unit: 1,
    },
  };

  console.log("\n📤 Response:");
  console.log(JSON.stringify(response, null, 2));
  console.log("=".repeat(80) + "\n");

  res.set({
    "Content-Type": "application/json",
    Connection: "close",
  });

  res.status(200).json(response);
});

// Mount record routes (handles /devices/claim/lefu/wifi/torre/record and /lefu/wifi/torre/record)
app.use("/", recordRoutes);

// Root path endpoints (for testing without /devices/claim prefix)
app.post("/lefu/wifi/torre/register", (req, res) => {
  console.log("🔧 Torre Device Registration (root path)");

  const response = {
    errorCode: 0,
    text: "Register success",
    data: {
      nowTime: Date.now(),
      unit: 0,
    },
  };

  console.log("\n📤 Response:");
  console.log(JSON.stringify(response, null, 2));
  console.log("=".repeat(80) + "\n");

  res.set({
    "Content-Type": "application/json",
    Connection: "close",
  });

  res.status(200).json(response);
});

app.post("/lefu/wifi/torre/config", (req, res) => {
  console.log("⚙️  Torre Device Configuration Sync (root path)");

  const now = Date.now();
  const response = {
    errorCode: 0,
    text: "Get config info success",
    data: {
      nowTime: now,
      now: now,
      nowTimeSecond: Math.floor(now / 1000),
      unit: 1,
    },
  };

  console.log("\n📤 Response:");
  console.log(JSON.stringify(response, null, 2));
  console.log("=".repeat(80) + "\n");

  res.set({
    "Content-Type": "application/json",
    Connection: "close",
  });

  res.status(200).json(response);
});

// Record endpoint is now handled by recordRoutes (mounted above)

// Wi-Fi Provisioning: Device registration endpoint during Wi-Fi setup
// This endpoint is called during the scale's Wi-Fi provisioning step
// Path: /unique-scale/lefu/wifi/torre/register
app.post("/unique-scale/lefu/wifi/torre/register", (req, res) => {
  console.log("🔧 Wi-Fi Provisioning: Torre Device Server Registration");
  console.log("📥 Request from scale during Wi-Fi setup");

  // Get the server hostname from environment or use Railway domain
  const serverHost =
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    process.env.SERVER_HOST ||
    "nuhealth-server-production.up.railway.app";

  // Detect scheme from request (X-Forwarded-Proto header for proxies, or req.protocol)
  const scheme =
    req.headers["x-forwarded-proto"] ||
    req.protocol ||
    process.env.SERVER_SCHEME ||
    "https";

  // Get port from environment or detect from request
  const port =
    process.env.SERVER_PORT ||
    req.headers["x-forwarded-port"] ||
    (scheme === "https" ? 443 : 80);

  const response = {
    code: 0,
    msg: "ok",
    server: serverHost,
    port: parseInt(port, 10),
    scheme: scheme.split(",")[0].trim(), // Handle comma-separated values from proxies
    path: "/unique-scale",
  };

  console.log("\n📤 Response (Wi-Fi Provisioning):");
  console.log(JSON.stringify(response, null, 2));
  console.log("=".repeat(80) + "\n");

  res.set({
    "Content-Type": "application/json",
    Connection: "close",
  });

  res.status(200).json(response);
});

// Wi-Fi Provisioning: Device configuration endpoint during Wi-Fi setup
// This endpoint is called after registration to get device configuration
// Path: /unique-scale/lefu/wifi/torre/config
app.post("/unique-scale/lefu/wifi/torre/config", (req, res) => {
  console.log("⚙️  Wi-Fi Provisioning: Torre Device Configuration Sync");
  console.log("📥 Request from scale during Wi-Fi setup");

  const now = Date.now();
  const response = {
    errorCode: 0,
    text: "Get config info success",
    data: {
      nowTime: now,
      now: now,
      nowTimeSecond: Math.floor(now / 1000),
      unit: 1,
    },
  };

  console.log("\n📤 Response (Wi-Fi Provisioning Config):");
  console.log(JSON.stringify(response, null, 2));
  console.log("=".repeat(80) + "\n");

  res.set({
    "Content-Type": "application/json",
    Connection: "close",
  });

  res.status(200).json(response);
});

// Error handler middleware - catch any unhandled errors
app.use((err, req, res, next) => {
  console.error("❌ Unhandled Server Error:");
  console.error("Error:", err);
  console.error("Message:", err.message);
  console.error("Stack:", err.stack);

  const response = {
    errorCode: 1,
    text: err.message || "Internal server error",
    data: null,
  };

  console.log("\n📤 Response:");
  console.log(JSON.stringify(response, null, 2));
  console.log("=".repeat(80) + "\n");

  res.status(err.status || 500).json(response);
});

// Catch-all for 404
app.use((req, res) => {
  console.log(`❌ 404 Not Found: ${req.method} ${req.path}`);

  const response = {
    errorCode: 1,
    text: "Endpoint not found",
    data: null,
  };

  console.log("\n📤 Response:");
  console.log(JSON.stringify(response, null, 2));
  console.log("=".repeat(80) + "\n");

  res.status(404).json(response);
});

app.listen(PORT, "0.0.0.0", () => {
  const serverUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://0.0.0.0:${PORT}`;

  console.log(`\n🚀 Lefu WiFi Torre Scale Server`);
  console.log(`   Listening on: ${serverUrl}`);
  console.log(`   Port: ${PORT}`);
  console.log(`\n📡 Available Endpoints:`);
  console.log(`   GET  /health - Health check with database/service status`);
  console.log(
    `   POST /devices/claim/lefu/wifi/torre/register - Device registration`
  );
  console.log(
    `   POST /devices/claim/lefu/wifi/torre/config - Device configuration sync`
  );
  console.log(
    `   POST /devices/claim/lefu/wifi/torre/checkForUpdate - Device update check`
  );
  console.log(
    `   POST /devices/claim/lefu/wifi/torre/record - Measurement data upload`
  );
  console.log(`\n   POST /lefu/wifi/torre/register (root path)`);
  console.log(`   POST /lefu/wifi/torre/config (root path)`);
  console.log(`   POST /lefu/wifi/torre/checkForUpdate (root path)`);
  console.log(`   POST /lefu/wifi/torre/record (root path)`);
  console.log(
    `\n   POST /unique-scale/lefu/wifi/torre/register - Wi-Fi provisioning registration`
  );
  console.log(
    `   POST /unique-scale/lefu/wifi/torre/config - Wi-Fi provisioning configuration`
  );
  console.log(`\n   GET /ota/:filename - OTA firmware file download`);
  console.log(`\n✅ Server ready - waiting for scale connections...\n`);
});
