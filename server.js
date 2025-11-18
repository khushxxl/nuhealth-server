const express = require("express");
const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());

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
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("\n📥 Request Body:");
    console.log(JSON.stringify(req.body, null, 2));
  }
  next();
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

// VENDOR PATTERN: Device POSTs measurement data to /devices/claim/lefu/wifi/torre/record
app.post("/devices/claim/lefu/wifi/torre/record", (req, res) => {
  console.log("📊 Torre Device Measurement Record (via /devices/claim path)");

  const response = {
    errorCode: 0,
    text: "Record uploaded successfully",
    data: {
      nowTime: Date.now(),
      recordId: Math.random().toString(36).substring(7),
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

app.post("/lefu/wifi/torre/record", (req, res) => {
  console.log("📊 Torre Device Measurement Record (root path)");

  const response = {
    errorCode: 0,
    text: "Record uploaded successfully",
    data: {
      nowTime: Date.now(),
      recordId: Math.random().toString(36).substring(7),
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

// Catch-all for debugging
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
  console.log(
    `   POST /devices/claim/lefu/wifi/torre/register - Device registration`
  );
  console.log(
    `   POST /devices/claim/lefu/wifi/torre/config - Device configuration sync`
  );
  console.log(
    `   POST /devices/claim/lefu/wifi/torre/record - Measurement data upload`
  );
  console.log(`\n   POST /lefu/wifi/torre/register (root path)`);
  console.log(`   POST /lefu/wifi/torre/config (root path)`);
  console.log(`   POST /lefu/wifi/torre/record (root path)`);
  console.log(`\n✅ Server ready - waiting for scale connections...\n`);
});
