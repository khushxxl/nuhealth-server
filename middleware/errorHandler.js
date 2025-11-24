/**
 * Error handler middleware - catch any unhandled errors
 */
function createErrorHandler() {
  return (err, req, res, next) => {
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
  };
}

/**
 * 404 Not Found handler
 */
function createNotFoundHandler() {
  return (req, res) => {
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
  };
}

module.exports = {
  createErrorHandler,
  createNotFoundHandler,
};

