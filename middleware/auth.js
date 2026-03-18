const { createClient } = require("@supabase/supabase-js");
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require("../config/constants");

/**
 * Authentication middleware for /api/* routes.
 * Validates Supabase JWT from Authorization header and attaches req.user.
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      errorCode: 1,
      text: "Unauthorized - missing or invalid Authorization header",
      data: null,
    });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      errorCode: 1,
      text: "Unauthorized - missing token",
      data: null,
    });
  }

  try {
    // Create a temporary Supabase client with the user's token to validate it
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        errorCode: 1,
        text: "Unauthorized - invalid or expired token",
        data: null,
      });
    }

    // Attach user info to request
    req.user = {
      id: user.id,
      email: user.email,
    };

    next();
  } catch (err) {
    console.error("❌ Auth middleware error:", err.message);
    return res.status(401).json({
      errorCode: 1,
      text: "Unauthorized - token validation failed",
      data: null,
    });
  }
}

module.exports = { authMiddleware };
