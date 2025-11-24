module.exports = {
  PORT: process.env.PORT || 8000,

  // Server base URL for OTA downloads (leave empty to auto-detect from request)
  // For localhost: "http://192.168.0.206:8000" (use your local IP)
  // For production: leave empty or set to your domain
  BASE_URL: process.env.BASE_URL || "http://192.168.0.206:8000",

  // Lefu API configuration
  LEFU_BASE_URL: "https://uniquehealth.lefuenergy.com",
  LEFU_APP_KEY: "lefu78add5b3f9a825d1",
  LEFU_APP_SECRET: "1wiM1vqItFgANY5WWaG0xl6LLj1UIqmmkuOojUwn2Jg=",

  // Supabase configuration
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
};
