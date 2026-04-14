const express = require("express");
const router = express.Router();
const { getJunctionClient } = require("../services/junction");
const { success, error } = require("../utils/apiResponse");

// POST /api/junction/create-user — Create a Junction user for the authenticated user
router.post("/junction/create-user", async (req, res) => {
  try {
    const junction = getJunctionClient();
    if (!junction) {
      return error(res, "Junction service not configured", 503);
    }

    const clientUserId = req.user.id;

    try {
      const junctionUser = await junction.user.create({
        clientUserId,
      });
      console.log(`✅ [Junction] Created user: ${junctionUser.userId} for ${clientUserId}`);
      return success(res, { junctionUserId: junctionUser.userId });
    } catch (err) {
      // If user already exists, Junction returns 400 with existing user info
      if (err.statusCode === 400 || err.status === 400) {
        console.log(`ℹ️ [Junction] User already exists for ${clientUserId}`);
        // Try to get existing user
        try {
          const users = await junction.user.getAll();
          const existing = users?.users?.find((u) => u.clientUserId === clientUserId);
          if (existing) {
            return success(res, { junctionUserId: existing.userId });
          }
        } catch (_) {}
        return error(res, "User already exists but could not retrieve ID", 409);
      }
      throw err;
    }
  } catch (err) {
    console.error("❌ POST /api/junction/create-user error:", err.message);
    return error(res, "Failed to create Junction user");
  }
});

// POST /api/junction/link-token — Generate a link token for connecting cloud wearables
router.post("/junction/link-token", async (req, res) => {
  try {
    const junction = getJunctionClient();
    if (!junction) {
      return error(res, "Junction service not configured", 503);
    }

    const { junctionUserId, provider } = req.body;
    if (!junctionUserId) {
      return error(res, "junctionUserId is required", 400);
    }

    const result = await junction.link.token({
      userId: junctionUserId,
      ...(provider && { provider }),
    });

    console.log(`✅ [Junction] Link token generated for user ${junctionUserId}`, JSON.stringify(result, null, 2));
    return success(res, { linkToken: result.linkToken, linkWebUrl: result.linkWebUrl });
  } catch (err) {
    console.error("❌ POST /api/junction/link-token error:", err.message);
    return error(res, "Failed to generate link token");
  }
});

// POST /api/junction/sign-in-token — Generate a sign-in token for mobile SDK auth
router.post("/junction/sign-in-token", async (req, res) => {
  try {
    const junction = getJunctionClient();
    if (!junction) {
      return error(res, "Junction service not configured", 503);
    }

    const { junctionUserId } = req.body;
    if (!junctionUserId) {
      return error(res, "junctionUserId is required", 400);
    }

    console.log(`📡 [Junction] Requesting sign-in token for user: ${junctionUserId}`);
    const result = await junction.user.getUserSignInToken(junctionUserId);
    console.log(`✅ [Junction] Sign-in token result:`, JSON.stringify(result, null, 2));

    return success(res, { signInToken: result.signInToken || result.sign_in_token });
  } catch (err) {
    console.error("❌ POST /api/junction/sign-in-token error:", err.message, err.body || err.statusCode || "");
    return error(res, "Failed to generate sign-in token");
  }
});

// POST /api/junction/connect-demo — Connect a demo (synthetic) provider in sandbox
// Creates a dedicated demo-only Junction user (demo connections can't coexist with real ones)
router.post("/junction/connect-demo", async (req, res) => {
  try {
    const junction = getJunctionClient();
    if (!junction) {
      return error(res, "Junction service not configured", 503);
    }

    const { provider } = req.body;
    if (!provider) {
      return error(res, "provider is required", 400);
    }

    const clientUserId = req.user.id;
    const demoClientUserId = `demo-${clientUserId}`;

    // Try to find or create a demo-only Junction user
    let demoJunctionUserId;
    try {
      const demoUser = await junction.user.create({ clientUserId: demoClientUserId });
      demoJunctionUserId = demoUser.userId;
      console.log(`✅ [Junction] Created demo user: ${demoJunctionUserId} for ${demoClientUserId}`);
    } catch (err) {
      if (err.statusCode === 400 || err.status === 400) {
        // Demo user already exists, find it
        const users = await junction.user.getAll();
        const existing = users?.users?.find((u) => u.clientUserId === demoClientUserId);
        if (existing) {
          demoJunctionUserId = existing.userId;
          console.log(`ℹ️ [Junction] Reusing demo user: ${demoJunctionUserId}`);
        } else {
          return error(res, "Demo user exists but could not retrieve ID", 500);
        }
      } else {
        throw err;
      }
    }

    console.log(`🔗 [Junction] Connecting demo provider: ${provider} for demo user ${demoJunctionUserId}`);
    const result = await junction.link.connectDemoProvider({
      userId: demoJunctionUserId,
      provider,
    });

    console.log(`✅ [Junction] Demo ${provider} connected:`, JSON.stringify(result, null, 2));
    return success(res, { ...result, demoJunctionUserId });
  } catch (err) {
    console.error("❌ POST /api/junction/connect-demo error:", err.message, err.body || err.statusCode || "");
    return error(res, `Failed to connect demo provider: ${err.message}`);
  }
});

// GET /api/junction/connected-providers — Check which providers a user has connected
router.get("/junction/connected-providers", async (req, res) => {
  try {
    const junction = getJunctionClient();
    if (!junction) {
      return error(res, "Junction service not configured", 503);
    }

    const { junctionUserId } = req.query;
    if (!junctionUserId) {
      return error(res, "junctionUserId is required", 400);
    }

    const user = await junction.user.get(junctionUserId);
    const providers = user?.connectedSources || [];
    return success(res, { providers });
  } catch (err) {
    console.error("❌ GET /api/junction/connected-providers error:", err.message);
    return error(res, "Failed to fetch connected providers");
  }
});

// POST /api/junction/register-provider — Register a manual provider (e.g. Apple Health via SDK)
router.post("/junction/register-provider", async (req, res) => {
  try {
    const junction = getJunctionClient();
    if (!junction) {
      return error(res, "Junction service not configured", 503);
    }

    const { junctionUserId, provider } = req.body;
    if (!junctionUserId || !provider) {
      return error(res, "junctionUserId and provider are required", 400);
    }

    console.log(`🔗 [Junction] Registering manual provider: ${provider} for user ${junctionUserId}`);
    const result = await junction.link.connectManualProvider(junctionUserId, provider);
    console.log(`✅ [Junction] Provider ${provider} registered:`, JSON.stringify(result));
    return success(res, result);
  } catch (err) {
    console.error("❌ POST /api/junction/register-provider error:", err.message, err.body || "");
    return error(res, `Failed to register provider: ${err.message}`);
  }
});

module.exports = router;
