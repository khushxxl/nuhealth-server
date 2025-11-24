/**
 * Logging middleware
 * Logs all incoming requests with detailed information
 */
function createLogger() {
  return (req, res, next) => {
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
  };
}

module.exports = {
  createLogger,
};

