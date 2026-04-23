const OpenAI = require("openai");
const { OPENAI_API_KEY } = require("../config/constants");
const { getServiceClient } = require("./supabase");

// Initialize OpenAI client
let openai = null;
if (OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
  });
  console.log("✅ OpenAI client initialized");
} else {
  console.log(
    "⚠️  OpenAI API key not found - AI summaries will not be generated"
  );
  console.log("   Set OPEN_AI_API environment variable");
}

// ─── Prompt Cache ─────────────────────────────────────────────────────────────

const promptCache = {};
let lastCacheTime = 0;
const CACHE_TTL = 60 * 1000; // 60 seconds

async function getPrompt(id) {
  const now = Date.now();

  if (promptCache[id] && now - lastCacheTime < CACHE_TTL) {
    return promptCache[id];
  }

  const supabase = getServiceClient();
  if (!supabase) {
    console.warn("Supabase not configured, using cached prompts");
    return promptCache[id] || null;
  }

  try {
    const { data, error } = await supabase.from("ai_prompts").select("*");
    if (error) {
      console.error("Failed to fetch prompts:", error.message);
      return promptCache[id] || null;
    }

    for (const row of data) {
      promptCache[row.id] = row;
    }
    lastCacheTime = now;
  } catch (err) {
    console.error("Prompt fetch error:", err.message);
  }

  return promptCache[id] || null;
}

/**
 * Interpolate ${variable} placeholders in a prompt template
 */
function interpolatePrompt(template, vars) {
  if (!template) return template;
  return template.replace(/\$\{(\w+(?:\.\w+)*)}/g, (match, key) => {
    return vars[key] !== undefined ? vars[key] : match;
  });
}

// ─── Hardcoded fallback prompts (used if Supabase is unavailable) ─────────────

const FALLBACK_SYSTEM_PROMPT =
  "You are a helpful health and wellness coach that provides encouraging, concise feedback about body composition metrics. Always respond with valid JSON only.";

const FALLBACK_USER_PROMPT = `You are a health and wellness coach. Generate a summary for the "\${goalName}" goal card based on body composition metrics from the last two weeks.

\${metricsText}

RULES:
- Never use "pp" in front of any metric name. Use plain names only: Weight, BMI, Heart Rate, BMR, Muscle, Fat, etc.
- \${weightUnitInstruction}

Generate a summary with:
1. HEADER: A short, encouraging header (25-35 characters including spaces).
2. BODY: A 2-line summary (160-190 characters total) reviewing trends over the last two weeks with specific numbers.

Format your response as JSON:
{
  "header": "Header text here",
  "body": "Line 1 text\\nLine 2 text"
}

Only include metrics that are in the provided list. Be specific with numbers and trends.`;

// ─── Metric Helpers ───────────────────────────────────────────────────────────

const KG_TO_LBS = 2.20462;

const WEIGHT_KG_KEYS = new Set([
  "ppWeightKg",
  "ppMuscleKg",
  "ppFatKg",
  "ppProteinKg",
  "ppBodySkeletalKg",
]);

function calculatePercentageChange(oldValue, newValue) {
  if (!oldValue || oldValue === 0) return null;
  return ((newValue - oldValue) / oldValue) * 100;
}

function getMetricDisplayName(key) {
  if (!key || typeof key !== "string") return key;
  const withoutPp = key.replace(/^pp/, "");
  const label = withoutPp
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
  return label;
}

function convertMetricsToLbs(metrics) {
  if (!metrics || typeof metrics !== "object") return metrics;
  const out = { ...metrics };
  WEIGHT_KG_KEYS.forEach((k) => {
    if (out[k] != null && typeof out[k] === "number") {
      out[k] = Math.round(out[k] * KG_TO_LBS * 10) / 10;
    }
  });
  return out;
}

function formatMetricValue(key, value, unit = "kg") {
  if (value === null || value === undefined) return null;

  const isLbs = unit === "lbs";
  if (WEIGHT_KG_KEYS.has(key)) {
    const rounded = typeof value === "number" ? Math.round(value * 10) / 10 : value;
    return isLbs ? `${rounded} lb` : `${rounded} kg`;
  }

  const unitMap = {
    ppBMI: "",
    ppHeartRate: "bpm",
    ppBMR: "kcal",
    ppFat: "%",
    ppBodyScore: "points",
    ppBodyAge: "years",
    ppMusclePercentage: "%",
    ppProteinPercentage: "%",
    ppWaterPercentage: "%",
  };

  const u = unitMap[key] || "";
  return u ? `${value} ${u}` : value.toString();
}

function buildMetricsComparisonText(currentMetrics, twoWeeksAgoMetrics, metricKeys, unit = "kg") {
  let text = "Current metrics (today):\n";
  const changes = [];

  metricKeys.forEach((key) => {
    const current = currentMetrics[key];
    const twoWeeksAgo = twoWeeksAgoMetrics?.[key];
    const displayName = getMetricDisplayName(key);

    if (current !== null && current !== undefined) {
      text += `- ${displayName}: ${formatMetricValue(key, current, unit)}`;

      if (twoWeeksAgo !== null && twoWeeksAgo !== undefined) {
        const change = current - twoWeeksAgo;
        const percentChange = calculatePercentageChange(twoWeeksAgo, current);

        text += ` (was ${formatMetricValue(key, twoWeeksAgo, unit)})`;

        if (percentChange !== null) {
          changes.push({
            key: displayName,
            change,
            percentChange: Math.abs(percentChange),
            direction: change > 0 ? "up" : change < 0 ? "down" : "stable",
          });
        }
      }
      text += "\n";
    }
  });

  if (changes.length > 0) {
    text += "\nKey changes over last two weeks:\n";
    changes.slice(0, 5).forEach((c) => {
      text += `- ${c.key}: ${c.direction} by ${Math.abs(c.change).toFixed(1)} (${c.percentChange.toFixed(1)}%)\n`;
    });
  }

  return text;
}

// ─── Goal Summary Generation ──────────────────────────────────────────────────

async function generateGoalSummary({
  goalName,
  currentMetrics,
  twoWeeksAgoMetrics = null,
  metricKeys,
  unit = "kg",
}) {
  if (!openai) {
    console.log("⚠️  OpenAI not configured - skipping summary generation");
    return null;
  }

  try {
    const metricsForUnit =
      unit === "lbs"
        ? {
            current: convertMetricsToLbs(currentMetrics),
            twoWeeksAgo: twoWeeksAgoMetrics
              ? convertMetricsToLbs(twoWeeksAgoMetrics)
              : null,
          }
        : {
            current: currentMetrics,
            twoWeeksAgo: twoWeeksAgoMetrics,
          };

    const metricsText = buildMetricsComparisonText(
      metricsForUnit.current,
      metricsForUnit.twoWeeksAgo,
      metricKeys,
      unit
    );

    const weightUnitInstruction =
      unit === "lbs"
        ? "Use only pounds (lb/lbs) for all weight-related values in the summary."
        : "Use only kilograms (kg) for all weight-related values in the summary.";

    const vars = { goalName, metricsText, weightUnitInstruction };

    // Fetch prompts from Supabase
    const systemPromptRow = await getPrompt("goal-summary-system");
    const userPromptRow = await getPrompt("goal-summary-user");

    const systemContent = systemPromptRow
      ? systemPromptRow.system_prompt
      : FALLBACK_SYSTEM_PROMPT;

    const userTemplate = userPromptRow
      ? (userPromptRow.user_prompt || userPromptRow.system_prompt)
      : FALLBACK_USER_PROMPT;

    const userContent = interpolatePrompt(userTemplate, vars);

    const model = userPromptRow?.model || "gpt-4o-mini";
    const temperature = userPromptRow?.temperature ?? 0.7;
    const maxTokens = userPromptRow?.max_tokens || 300;

    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
      ],
      max_tokens: maxTokens,
      temperature,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (content) {
      try {
        const parsed = JSON.parse(content);
        if (parsed.header && parsed.body) {
          return {
            header: parsed.header.trim(),
            body: parsed.body.trim(),
          };
        }
      } catch (parseError) {
        console.error(`❌ Error parsing JSON for ${goalName}:`, parseError);
        const lines = content.split("\n").filter((line) => line.trim());
        if (lines.length >= 2) {
          return {
            header: lines[0].trim().substring(0, 35),
            body: lines.slice(1).join("\n").trim(),
          };
        }
      }
    }

    return null;
  } catch (error) {
    console.error(
      `❌ Error generating summary for ${goalName}:`,
      error.message
    );
    return null;
  }
}

/**
 * Generate summaries for all 7 goal cards
 */
async function generateAllGoalSummaries(
  currentMetrics,
  twoWeeksAgoMetrics = null
) {
  const summaries = {};

  const goalConfigs = [
    {
      name: "Overview",
      keys: ["ppWeightKg", "ppHeartRate", "ppBMI", "ppWaterPercentage", "ppBodyAge", "ppBodyScore"],
    },
    {
      name: "Recovery",
      keys: ["ppWeightKg", "ppHeartRate", "ppBMR", "ppBMI", "ppMusclePercentage", "ppMuscleKg", "ppProteinPercentage", "ppProteinKg", "ppWaterPercentage", "ppBodySkeletalKg", "ppBodyScore"],
    },
    {
      name: "Energy",
      keys: ["ppWeightKg", "ppHeartRate", "ppBMR", "ppMusclePercentage", "ppMuscleKg", "ppProteinPercentage", "ppProteinKg", "ppWaterPercentage", "ppBodySkeletalKg", "ppBodyAge", "ppBodyScore"],
    },
    {
      name: "Longevity",
      keys: ["ppWeightKg", "ppHeartRate", "ppBMR", "ppBMI", "ppFat", "ppFatKg", "ppMusclePercentage", "ppMuscleKg", "ppProteinPercentage", "ppProteinKg", "ppWaterPercentage", "ppBodyAge", "ppBodyScore"],
    },
    {
      name: "Weight Loss",
      keys: ["ppWeightKg", "ppHeartRate", "ppBMR", "ppBMI", "ppFat", "ppFatKg", "ppMusclePercentage", "ppMuscleKg", "ppWaterPercentage", "ppBodyAge", "ppBodyScore"],
    },
    {
      name: "Pain Relief",
      keys: ["ppHeartRate", "ppBMR", "ppFat", "ppFatKg", "ppMusclePercentage", "ppMuscleKg", "ppWaterPercentage", "ppBodySkeletalKg", "ppBodyScore"],
    },
    {
      name: "General Health",
      keys: ["ppWeightKg", "ppHeartRate", "ppBMR", "ppBMI", "ppFat", "ppFatKg", "ppMusclePercentage", "ppMuscleKg", "ppProteinPercentage", "ppProteinKg", "ppWaterPercentage", "ppBodyAge", "ppBodyScore"],
    },
  ];

  const defaultSummary = {
    header: "Tracking progress",
    body: "Progress tracking in progress...",
  };

  for (const config of goalConfigs) {
    const [summaryKg, summaryLbs] = await Promise.all([
      generateGoalSummary({
        goalName: config.name,
        currentMetrics,
        twoWeeksAgoMetrics,
        metricKeys: config.keys,
        unit: "kg",
      }),
      generateGoalSummary({
        goalName: config.name,
        currentMetrics,
        twoWeeksAgoMetrics,
        metricKeys: config.keys,
        unit: "lbs",
      }),
    ]);

    summaries[config.name] = {
      kg: summaryKg || defaultSummary,
      lbs: summaryLbs || defaultSummary,
    };
  }

  return summaries;
}

module.exports = {
  generateGoalSummary,
  generateAllGoalSummaries,
  isOpenAIConfigured: () => openai !== null,
};
