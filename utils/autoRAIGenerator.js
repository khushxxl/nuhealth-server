/**
 * Auto-generates RAI insights & tips for all key metrics on a new scale record.
 * Pro-only — checks users.subscription_status before doing any work.
 *
 * For each tracked metric (weight, fat, muscle, BMI, etc.) it:
 *   1. Calls OpenAI via the metric-analysis prompt (cached in ai_prompts table)
 *   2. Writes rai_insights + rai_tips into scale_measurements row matching body_param_key
 *
 * Non-blocking: failures are logged but never throw, so the scale record save
 * itself is unaffected.
 */

const { OPENAI_API_KEY } = require("../config/constants");
const { getServiceClient } = require("../services/supabase");

// Metrics we auto-generate RAI for (subset of all body_param_keys; the high-signal ones)
const AUTO_RAI_METRICS = [
  "ppWeightKg",
  "ppFat",
  "ppBodyfatKg",
  "ppMuscleKg",
  "ppBMI",
  "ppBodySkeletalKg",
  "ppMusclePercentage",
  "ppWaterPercentage",
  "ppProteinKg",
  "ppVisceralFat",
  "ppBodyAge",
  "ppBodyScore",
];

const PRO_STATUSES = new Set(["ACTIVE", "active", "trialing"]);

// ─── Prompt cache (60s, shared pattern) ───────────────────────────────────────

const promptCache = {};
let lastCacheTime = 0;
const CACHE_TTL = 60 * 1000;

async function getPrompt(id) {
  const now = Date.now();
  if (promptCache[id] && now - lastCacheTime < CACHE_TTL) return promptCache[id];

  const supabase = getServiceClient();
  if (!supabase) return promptCache[id] || null;

  try {
    const { data, error } = await supabase.from("ai_prompts").select("*");
    if (!error && data) {
      for (const row of data) promptCache[row.id] = row;
      lastCacheTime = now;
    }
  } catch (err) {
    console.warn("[AutoRAI] Prompt cache error:", err.message);
  }
  return promptCache[id] || null;
}

async function callOpenAI(messages, { model = "gpt-4o-mini", temperature = 0.7, maxTokens = 600 } = {}) {
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  const data = await response.json();
  let content = data.choices[0].message.content.trim();
  content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return content;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function generateAutoRAIForRecord({
  userId,
  recordId,
  mutatedBodyData,
}) {
  if (!userId || !recordId || !Array.isArray(mutatedBodyData)) {
    return { success: false, reason: "Missing inputs" };
  }

  const supabase = getServiceClient();
  if (!supabase) return { success: false, reason: "Supabase not configured" };

  // 1. Pro check
  const { data: user } = await supabase
    .from("users")
    .select("name, email, subscription_status, onboarding_answers")
    .eq("id", userId)
    .maybeSingle();

  if (!user) {
    console.log("[AutoRAI] User not found, skipping");
    return { success: false, reason: "User not found" };
  }

  const isPro = PRO_STATUSES.has(String(user.subscription_status || ""));
  if (!isPro) {
    console.log(`[AutoRAI] User ${userId} is not Pro, skipping auto RAI generation`);
    return { success: false, reason: "Not pro" };
  }

  // 2. Fetch user goals + latest check-in for context (best-effort)
  let userGoals = null;
  let userLastData = "No recent check-in data available";

  try {
    const { data: goalRow } = await supabase
      .from("user_goals")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    userGoals = goalRow || null;
  } catch {
    // ignore
  }

  try {
    const { data: checkin } = await supabase
      .from("personalization")
      .select("checkin_results")
      .eq("userid", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (checkin?.checkin_results?.length) {
      const latest = checkin.checkin_results[checkin.checkin_results.length - 1];
      userLastData = JSON.stringify(latest);
    }
  } catch {
    // ignore
  }

  // 3. Get the AI prompt (same one the on-demand client flow uses)
  const promptRow = await getPrompt("metric-analysis");
  if (!promptRow) {
    console.warn("[AutoRAI] metric-analysis prompt not found in ai_prompts table");
    return { success: false, reason: "Prompt missing" };
  }

  // 4. Filter target metrics from this record
  const targetMetrics = mutatedBodyData.filter((item) => {
    if (!item) return false;
    const key = item.bodyParamKey || item.body_param_key;
    return AUTO_RAI_METRICS.includes(key);
  });

  if (targetMetrics.length === 0) {
    console.log("[AutoRAI] No target metrics found in this record");
    return { success: true, generated: 0 };
  }

  console.log(`[AutoRAI] Generating RAI for ${targetMetrics.length} metric(s) for Pro user ${userId}`);

  let generated = 0;

  // 5. For each target metric, call OpenAI and save back
  for (const metric of targetMetrics) {
    const key = metric.bodyParamKey || metric.body_param_key;
    const name = metric.bodyParamName || metric.body_param_name || key;
    const value = metric.currentValue ?? metric.current_value;
    const unit = metric.unit || "";
    const status = metric.standardTitle || metric.standard_title || "";

    const userInformation = JSON.stringify({
      name: user.name || "User",
      email: user.email,
      onboarding_answers: user.onboarding_answers || [],
      current_metric: {
        id: key,
        title: name,
        value: `${value}${unit ? " " + unit : ""}`,
        status,
      },
    });

    const userGoal = userGoals ? JSON.stringify(userGoals) : "None";

    try {
      // Build messages from prompt template (no interpolation needed — prompt has its own placeholders)
      const messages = [
        { role: "system", content: promptRow.system_prompt },
        {
          role: "user",
          content: `User Information: ${userInformation}\nUser Goal: ${userGoal}\nUser Last Data: ${userLastData}`,
        },
      ];

      const MAX_RETRIES = 2;
      let parsed = null;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const raw = await callOpenAI(messages, {
            model: promptRow.model || "gpt-4o-mini",
            temperature: promptRow.temperature ?? 0.7,
            maxTokens: promptRow.max_tokens || 600,
          });
          parsed = JSON.parse(raw);
          break;
        } catch (err) {
          if (attempt === MAX_RETRIES - 1) throw err;
          messages.push({
            role: "user",
            content: "Invalid JSON. Return strictly valid JSON only.",
          });
        }
      }

      if (!parsed?.rai_insights || !Array.isArray(parsed.rai_tips)) {
        console.warn(`[AutoRAI] Invalid response shape for ${key}, skipping`);
        continue;
      }

      // 6. Save to scale_measurements row matching this record + body_param_key
      const { error: updateErr } = await supabase
        .from("scale_measurements")
        .update({
          rai_insights: parsed.rai_insights,
          rai_tips: parsed.rai_tips,
        })
        .eq("scale_record_id", recordId)
        .eq("body_param_key", key);

      if (updateErr) {
        console.warn(`[AutoRAI] DB update failed for ${key}:`, updateErr.message);
      } else {
        generated += 1;
        console.log(`[AutoRAI] ✅ ${key}: saved insights + ${parsed.rai_tips.length} tips`);
      }
    } catch (err) {
      console.warn(`[AutoRAI] Failed for ${key}:`, err.message);
    }
  }

  console.log(`[AutoRAI] Done — generated RAI for ${generated}/${targetMetrics.length} metrics`);
  return { success: true, generated, total: targetMetrics.length };
}

module.exports = { generateAutoRAIForRecord };
