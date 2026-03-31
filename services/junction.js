const { VitalClient, VitalEnvironment } = require("@tryvital/vital-node");
const { JUNCTION_API_KEY, JUNCTION_ENVIRONMENT } = require("../config/constants");

let junctionClient = null;

if (JUNCTION_API_KEY) {
  junctionClient = new VitalClient({
    apiKey: JUNCTION_API_KEY,
    environment:
      JUNCTION_ENVIRONMENT === "production"
        ? VitalEnvironment.Production
        : VitalEnvironment.Sandbox,
  });
  console.log(`✅ Junction client initialized (${JUNCTION_ENVIRONMENT})`);
} else {
  console.log("⚠️  Junction API key not found — wearable integration disabled");
}

function getJunctionClient() {
  return junctionClient;
}

module.exports = { getJunctionClient };
