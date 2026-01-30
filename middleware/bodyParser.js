const express = require("express");

/**
 * Custom body parser middleware
 * Captures raw body as text first, then parses JSON manually
 * This allows us to handle malformed JSON gracefully
 */
function createBodyParser() {
  // Capture raw body as text first
  const textParser = express.text({ type: "*/*", limit: "10mb" });

  return (req, res, next) => {
    // First, use express.text() to capture raw body
    textParser(req, res, () => {
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
  };
}

module.exports = {
  createBodyParser,
};

