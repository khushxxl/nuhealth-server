const express = require("express");
const router = express.Router();
const { OPENAI_API_KEY } = require("../config/constants");
const { getServiceClient } = require("../services/supabase");
const { success, error } = require("../utils/apiResponse");

// ─── Prompt Cache (refreshes every 60s) ───────────────────────────────────────

const promptCache = {};
let lastCacheTime = 0;
const CACHE_TTL = 60 * 1000; // 60 seconds

async function getPrompt(id) {
  const now = Date.now();

  // Return cached if fresh
  if (promptCache[id] && now - lastCacheTime < CACHE_TTL) {
    return promptCache[id];
  }

  // Refresh entire cache
  const supabase = getServiceClient();
  if (!supabase) {
    console.warn("Supabase not configured, prompts unavailable");
    return null;
  }

  const { data, error: err } = await supabase.from("ai_prompts").select("*");
  if (err) {
    console.error("Failed to fetch prompts:", err.message);
    return promptCache[id] || null; // fallback to stale cache
  }

  // Rebuild cache
  for (const row of data) {
    promptCache[row.id] = row;
  }
  lastCacheTime = now;

  return promptCache[id] || null;
}

// ─── OpenAI Helper ────────────────────────────────────────────────────────────

async function callOpenAI(messages, { model = "gpt-4o", temperature = 0.7, maxTokens } = {}) {
  const body = {
    model,
    messages,
    temperature,
  };
  if (maxTokens) body.max_tokens = maxTokens;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/ai/chat
 * Body: { messages: [{ role, content }], type: "summary" | "breakdown" }
 */
router.post("/ai/chat", async (req, res) => {
  try {
    const { messages, type = "summary" } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return error(res, "messages array is required", 400);
    }

    const promptId = type === "breakdown" ? "rai-chat-breakdown" : "rai-chat-summary";
    const prompt = await getPrompt(promptId);
    if (!prompt) {
      return error(res, `Prompt "${promptId}" not found`, 500);
    }

    const result = await callOpenAI([
      { role: "system", content: prompt.system_prompt },
      ...messages,
    ], { model: prompt.model, temperature: prompt.temperature, maxTokens: prompt.max_tokens });

    return success(res, { response: result });
  } catch (err) {
    console.error("AI chat error:", err.message);
    return error(res, "Failed to generate AI response", 500);
  }
});

/**
 * POST /api/ai/metric-analysis
 * Body: { userInformation, userGoal, userLastData }
 */
router.post("/ai/metric-analysis", async (req, res) => {
  try {
    const { userInformation, userGoal, userLastData } = req.body;
    if (!userInformation || !userLastData) {
      return error(res, "userInformation and userLastData are required", 400);
    }

    const prompt = await getPrompt("metric-analysis");
    if (!prompt) {
      return error(res, "Prompt 'metric-analysis' not found", 500);
    }

    const MAX_RETRIES = 3;
    let attempts = 0;
    const messages = [
      { role: "system", content: prompt.system_prompt },
      {
        role: "user",
        content: `User Information: ${userInformation}\nUser Goal: ${userGoal || "None"}\nUser Last Data: ${userLastData}`,
      },
    ];

    while (attempts < MAX_RETRIES) {
      try {
        const result = await callOpenAI(messages, {
          model: prompt.model,
          temperature: prompt.temperature,
          maxTokens: prompt.max_tokens,
        });
        const parsed = JSON.parse(result);
        return success(res, parsed);
      } catch (parseErr) {
        attempts++;
        if (attempts < MAX_RETRIES) {
          messages.push({
            role: "user",
            content: "The last output was invalid JSON. Please reformat it into strictly valid JSON only, matching the schema exactly.",
          });
        }
      }
    }

    return error(res, "Failed to generate valid metric analysis after retries", 500);
  } catch (err) {
    console.error("Metric analysis error:", err.message);
    return error(res, "Failed to generate metric analysis", 500);
  }
});

/**
 * POST /api/ai/user-history
 * Body: { messages: { role, content } }
 */
router.post("/ai/user-history", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages) {
      return error(res, "messages is required", 400);
    }

    const prompt = await getPrompt("user-history");
    if (!prompt) {
      return error(res, "Prompt 'user-history' not found", 500);
    }

    const result = await callOpenAI([
      { role: "system", content: prompt.system_prompt },
      messages,
    ], { model: prompt.model, temperature: prompt.temperature, maxTokens: prompt.max_tokens });

    return success(res, { analysis: result });
  } catch (err) {
    console.error("User history analysis error:", err.message);
    return error(res, "Failed to analyze user history", 500);
  }
});

/**
 * POST /api/ai/personalise
 * Body: { messages: [{ role, content }] }
 */
router.post("/ai/personalise", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return error(res, "messages array is required", 400);
    }

    const prompt = await getPrompt("personalise-routine");
    if (!prompt) {
      return error(res, "Prompt 'personalise-routine' not found", 500);
    }

    const MAX_RETRIES = 3;
    let attempts = 0;
    const allMessages = [
      { role: "system", content: prompt.system_prompt },
      ...messages,
    ];

    while (attempts < MAX_RETRIES) {
      try {
        const result = await callOpenAI(allMessages, {
          model: prompt.model,
          temperature: prompt.temperature,
          maxTokens: prompt.max_tokens,
        });
        const parsed = JSON.parse(result);
        return success(res, parsed);
      } catch (parseErr) {
        attempts++;
        if (attempts < MAX_RETRIES) {
          allMessages.push({
            role: "user",
            content: "The last output was invalid JSON. Please reformat it into strictly valid JSON only, matching the schema exactly.",
          });
        }
      }
    }

    return error(res, "Failed to generate personalised routine after retries", 500);
  } catch (err) {
    console.error("Personalise error:", err.message);
    return error(res, "Failed to generate personalised routine", 500);
  }
});

module.exports = router;
