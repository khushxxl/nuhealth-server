const express = require("express");
const router = express.Router();
const path = require("path");

/**
 * Device Registration Endpoint
 * POST /devices/claim/lefu/wifi/torre/register
 * POST /lefu/wifi/torre/register
 */
function handleRegister(req, res) {
  console.log("🔧 Torre Device Registration");

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
}

/**
 * Device Configuration Sync Endpoint
 * POST /devices/claim/lefu/wifi/torre/config
 * POST /lefu/wifi/torre/config
 */
function handleConfig(req, res) {
  console.log("⚙️  Torre Device Configuration Sync");

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
}

/**
 * Device Update Check Endpoint
 * POST /devices/claim/lefu/wifi/torre/checkForUpdate
 * POST /lefu/wifi/torre/checkForUpdate
 *
 * Returns a list of TorreVersionUrl objects containing firmware update information.
 * Each object contains: type, productComponent (BLE/MCU/WIFI), crc, url, size, version
 */
async function handleCheckForUpdate(req, res) {
  console.log("🔄 Torre Device Update Check");
  console.log("   Request parameters:", JSON.stringify(req.body, null, 2));

  const {
    wifiVersion,
    bleVersion,
    resVersion,
    mcuVersion,
    sn,
    mac,
    type,
    bat,
  } = req.body;

  // Log device info for debugging
  if (sn) {
    console.log(`   Device SN: ${sn}`);
  }
  if (type) {
    console.log(`   Device Type: ${type}`);
  }
  if (wifiVersion || bleVersion || resVersion || mcuVersion) {
    console.log(
      `   Versions - WiFi: ${wifiVersion}, BLE: ${bleVersion}, Res: ${resVersion}, MCU: ${mcuVersion}`
    );
  }

  // Hardcoded OTA update response
  const nowTime = Date.now();
  const result = [
    {
      id: 835,
      type: "CF636",
      productComponent: "BLE",
      crc: "23151",
      url: "https://fire-versions.oss-accelerate.aliyuncs.com/prod/ota1763626759126/CF636_Nurecover_BLE_OTA_V004_20251120.bin",
      size: "401472",
      version: "004",
      createTime: "2025-11-20 16:19:25",
      nowTime: nowTime,
      whitelist: null,
    },
    {
      id: 834,
      type: "CF636",
      productComponent: "WIFI",
      crc: "49702",
      url: "https://fire-versions.oss-accelerate.aliyuncs.com/prod/ota1763626070859/CF636_WIFI_OTA_V005_20251120.bin",
      size: "833984",
      version: "005",
      createTime: "2025-11-20 16:07:57",
      nowTime: nowTime,
      whitelist: null,
    },
    {
      id: 792,
      type: "CF636",
      productComponent: "RES",
      crc: "37049",
      url: "https://fire-versions.oss-accelerate.aliyuncs.com/prod/ota1761915228188/CF636_Nurecover_ALL_RES_OTA_V406_20251031.bin",
      size: "4899576",
      version: "406",
      createTime: "2025-10-31 20:53:54",
      nowTime: nowTime,
      whitelist: null,
    },
    {
      id: 790,
      type: "CF636",
      productComponent: "MCU",
      crc: "60986",
      url: "https://fire-versions.oss-accelerate.aliyuncs.com/prod/ota1761915186472/CF636_Nurecover_MCU_OTA_V002_20251024.bin",
      size: "32768",
      version: "002",
      createTime: "2025-10-31 20:53:12",
      nowTime: nowTime,
      whitelist: null,
    },
  ];

  const response = {
    data: result,
    code: 200,
    errorCode: 0,
    text: "checkForUpdate success",
  };

  console.log("\n📤 Response:");
  console.log(JSON.stringify(response, null, 2));
  console.log("=".repeat(80) + "\n");

  res.set({
    "Content-Type": "application/json",
    Connection: "close",
  });

  res.status(200).json(response);
}

// Vendor pattern routes (with /devices/claim prefix)
router.post("/devices/claim/lefu/wifi/torre/register", handleRegister);
router.post("/devices/claim/lefu/wifi/torre/config", handleConfig);
router.post(
  "/devices/claim/lefu/wifi/torre/checkForUpdate",
  handleCheckForUpdate
);

// Root path routes (for testing)
router.post("/lefu/wifi/torre/register", handleRegister);
router.post("/lefu/wifi/torre/config", handleConfig);
router.post("/lefu/wifi/torre/checkForUpdate", handleCheckForUpdate);

/**
 * OTA File Download Endpoint
 * GET /ota/:filename
 * Serves OTA firmware files from the ota/ directory
 */
router.get("/ota/:filename", (req, res) => {
  const filename = req.params.filename;

  // Security: prevent directory traversal
  if (
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    return res.status(400).json({
      errorCode: 1,
      text: "Invalid filename",
      data: null,
    });
  }

  const filePath = path.resolve(__dirname, "..", "ota", filename);

  console.log(`📥 Serving OTA file: ${filename}`);

  res.sendFile(
    filePath,
    {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    },
    (err) => {
      if (err) {
        console.error(`Error serving OTA file ${filename}:`, err.message);
        if (!res.headersSent) {
          res.status(404).json({
            errorCode: 1,
            text: "OTA file not found",
            data: null,
          });
        }
      } else {
        console.log(`✅ OTA file served: ${filename}`);
      }
    }
  );
});

module.exports = router;
