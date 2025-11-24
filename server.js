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

const app = express();

// Middleware
app.use(createBodyParser());
app.use(createLogger());

// Routes
app.use(deviceRoutes);
app.use(recordRoutes);

// Error handlers (must be last)
app.use(createErrorHandler());
app.use(createNotFoundHandler());

// Start server
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
    `   POST /devices/claim/lefu/wifi/torre/checkForUpdate - Device update check`
  );
  console.log(
    `   POST /devices/claim/lefu/wifi/torre/record - Measurement data upload`
  );
  console.log(`\n   POST /lefu/wifi/torre/register (root path)`);
  console.log(`   POST /lefu/wifi/torre/config (root path)`);
  console.log(`   POST /lefu/wifi/torre/checkForUpdate (root path)`);
  console.log(`   POST /lefu/wifi/torre/record (root path)`);
  console.log(`\n   GET /ota/:filename - OTA firmware file download`);
  console.log(`\n✅ Server ready - waiting for scale connections...\n`);
});
