const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");

const OTA_DIR = path.join(__dirname, "..", "ota");

/**
 * Parse OTA filename to extract component information
 * Example: CF636_Nurecover_BLE_OTA_40D9H_V004_20251120.bin
 * Returns: { type, component, version, date, filename }
 */
function parseOTAFilename(filename) {
  // Remove .bin extension
  const nameWithoutExt = filename.replace(/\.bin$/, "");

  // Pattern: CF636_Nurecover_BLE_OTA_40D9H_V004_20251120
  // or: CF636_WIFI_OTA_V005_20251120
  // or: CF636_Nurecover_ALL_RES_OTA_V406_20251031

  const parts = nameWithoutExt.split("_");

  let type = null;
  let component = null;
  let version = null;
  let date = null;

  // Find type (usually starts with CF)
  type = parts.find((p) => /^CF\d+/.test(p)) || parts[0];

  // Find component (BLE, MCU, WIFI, RES)
  if (nameWithoutExt.includes("_BLE_")) {
    component = "BLE";
  } else if (nameWithoutExt.includes("_MCU_")) {
    component = "MCU";
  } else if (nameWithoutExt.includes("_WIFI_")) {
    component = "WIFI";
  } else if (
    nameWithoutExt.includes("_RES_") ||
    nameWithoutExt.includes("ALL_RES")
  ) {
    component = "RES";
  }

  // Find version (V followed by numbers/letters)
  const versionMatch = nameWithoutExt.match(/V([A-Z0-9]+)/);
  if (versionMatch) {
    version = versionMatch[1];
  }

  // Find date (8 digits at the end)
  const dateMatch = nameWithoutExt.match(/(\d{8})$/);
  if (dateMatch) {
    date = dateMatch[1];
  }

  return {
    type,
    component,
    version,
    date,
    filename,
  };
}

/**
 * Calculate a simple hash/checksum of a file (using MD5 as fallback)
 * For production, you may want to use actual CRC32
 */
async function calculateCRC(filePath) {
  try {
    const data = await fs.readFile(filePath);
    // Use file size as identifier (can be replaced with actual CRC32 if needed)
    // For now, using a hash of filename + size as a simple checksum
    const stats = await fs.stat(filePath);
    const hash = crypto
      .createHash("md5")
      .update(data.slice(0, 1024))
      .digest("hex");
    // Return first 8 characters as a simple checksum identifier
    return hash.substring(0, 8).toUpperCase();
  } catch (error) {
    console.error(`Error calculating CRC for ${filePath}:`, error.message);
    // Fallback: use file size as a simple identifier
    const stats = await fs.stat(filePath);
    return stats.size.toString().substring(0, 8);
  }
}

/**
 * Get file size in bytes
 */
async function getFileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.size.toString();
  } catch (error) {
    console.error(`Error getting file size for ${filePath}:`, error.message);
    return "0";
  }
}

/**
 * Scan OTA directory and return all available OTA files with metadata
 */
async function scanOTAFiles() {
  try {
    const files = await fs.readdir(OTA_DIR);
    const binFiles = files.filter((f) => f.endsWith(".bin"));

    const otaFiles = [];

    for (const filename of binFiles) {
      const filePath = path.join(OTA_DIR, filename);
      const parsed = parseOTAFilename(filename);
      const size = await getFileSize(filePath);
      const crc = await calculateCRC(filePath);

      otaFiles.push({
        ...parsed,
        size,
        crc,
        filePath,
      });
    }

    return otaFiles;
  } catch (error) {
    console.error("Error scanning OTA directory:", error.message);
    return [];
  }
}

/**
 * Find matching OTA files for a device
 * @param {string} deviceType - Device type (e.g., "CF636", "CF577")
 * @param {string} component - Component to check (BLE, MCU, WIFI, RES)
 * @returns {Object|null} Matching OTA file info or null
 */
async function findOTAForComponent(deviceType, component) {
  const otaFiles = await scanOTAFiles();

  // Filter by device type and component
  const matches = otaFiles.filter((ota) => {
    const typeMatch =
      !deviceType || ota.type === deviceType || ota.type?.includes(deviceType);
    const componentMatch = ota.component === component;
    return typeMatch && componentMatch;
  });

  // Return the most recent one (by date) if multiple matches
  if (matches.length > 0) {
    matches.sort((a, b) => {
      const dateA = a.date || "";
      const dateB = b.date || "";
      return dateB.localeCompare(dateA); // Descending order (newest first)
    });
    return matches[0];
  }

  return null;
}

/**
 * Get OTA file path by filename
 */
function getOTAPath(filename) {
  return path.join(OTA_DIR, filename);
}

module.exports = {
  scanOTAFiles,
  findOTAForComponent,
  getOTAPath,
  parseOTAFilename,
};
