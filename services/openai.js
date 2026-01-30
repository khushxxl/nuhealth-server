const OpenAI = require("openai");
const { OPENAI_API_KEY } = require("../config/constants");

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

const KG_TO_LBS = 2.20462;

/** Weight-related metric keys (values in kg in source data) */
const WEIGHT_KG_KEYS = new Set([
  "ppWeightKg",
  "ppMuscleKg",
  "ppFatKg",
  "ppProteinKg",
  "ppBodySkeletalKg",
]);

/**
 * Calculate percentage change between two values
 */
function calculatePercentageChange(oldValue, newValue) {
  if (!oldValue || oldValue === 0) return null;
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Get display name for metric key (never use "pp" in summaries)
 */
function getMetricDisplayName(key) {
  if (!key || typeof key !== "string") return key;
  const withoutPp = key.replace(/^pp/, "");
  // Humanize: ppWeightKg -> Weight (kg), ppHeartRate -> Heart Rate
  const label = withoutPp
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
  return label;
}

/**
 * Convert a copy of metrics to lbs for weight-related keys (source in kg)
 */
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

/**
 * Format metric value with unit. unit is 'kg' or 'lbs'.
 * For weight keys, when unit is 'lbs' the value is already in lbs (caller converted).
 * Never use "pp" in the metric name (handled by caller using getMetricDisplayName).
 */
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

/**
 * Build metrics comparison text for prompt. Uses display names (no "pp").
 * unit is 'kg' or 'lbs' for weight-related values.
 */
function buildMetricsComparisonText(
  currentMetrics,
  twoWeeksAgoMetrics,
  metricKeys,
  unit = "kg"
) {
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
      text += `- ${c.key}: ${c.direction} by ${Math.abs(c.change).toFixed(
        1
      )} (${c.percentChange.toFixed(1)}%)\n`;
    });
  }

  return text;
}

/**
 * Generate AI summary for a goal card with header and body (one unit: kg or lbs)
 * @param {Object} params - Parameters for summary generation
 * @param {string} params.goalName - Name of the goal (e.g., "General Health")
 * @param {Object} params.currentMetrics - Current metric values (in kg for weight keys)
 * @param {Object} params.twoWeeksAgoMetrics - Metrics from two weeks ago (optional)
 * @param {Array} params.metricKeys - Array of metric keys for this goal
 * @param {'kg'|'lbs'} params.unit - Use 'kg' or 'lbs' for weight-related values in the summary
 * @returns {Promise<Object|null>} Generated summary with header and body or null if failed
 */
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

    const prompt = `You are a health and wellness coach. Generate a summary for the "${goalName}" goal card based on body composition metrics from the last two weeks.

${metricsText}

RULES:
- Never use "pp" in front of any metric name. Use plain names only: Weight, BMI, Heart Rate, BMR, Muscle, Fat, etc.
- ${weightUnitInstruction}

Generate a summary with:
1. HEADER: A short, encouraging header (25-35 characters including spaces). Examples: "Your overall trends this week", "Recovery score on the rise", "Daily energy adapting well"

2. BODY: A 2-line summary (160-190 characters total, or up to 220-240 if 3 lines needed) that:
   - Reviews trends over the last two weeks
   - Uses specific numbers with units (${unit === "lbs" ? "lb/lbs" : "kg"}, %, bpm, kcal, points, etc.) — never use "pp" before any metric
   - Celebrates wins and improvements
   - Encourages on areas needing attention
   - Contextualizes why changes relate to the goal
   - Mentions "over the last two weeks" or "in the past two weeks"
   - Focuses on well-known metrics but doesn't ignore lesser-known ones
   - Uses percentage changes and quantity changes (e.g., "by about X ${unit === "lbs" ? "lb" : "kg"} (Y%)")

Format your response as JSON:
{
  "header": "Header text here",
  "body": "Line 1 text\nLine 2 text"
}

Only include metrics that are in the provided list. Be specific with numbers and trends.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful health and wellness coach that provides encouraging, concise feedback about body composition metrics. Always respond with valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 300,
      temperature: 0.7,
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
        // Fallback: try to extract header and body from text
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
 * Generate summaries for all 6 goal cards
 * @param {Object} currentMetrics - Current metric values from body data
 * @param {Object} twoWeeksAgoMetrics - Metrics from two weeks ago (optional)
 * @returns {Promise<Object>} Object with summaries (header + body) for each goal
 */
async function generateAllGoalSummaries(
  currentMetrics,
  twoWeeksAgoMetrics = null
) {
  const summaries = {};

  // Goal card configurations with all relevant metrics
  // Mapping user-provided metric names to actual body data keys (pp prefix)
  const goalConfigs = [
    {
      name: "Overview",
      keys: [
        "ppWeightKg",
        "ppHeartRate",
        "ppBMI",
        "ppWaterPercentage",
        "ppBodyAge",
        "ppBodyScore",
        // Note: Arm/Leg/Trunk metrics would need specific keys if available in body data
      ],
    },
    {
      name: "Recovery",
      keys: [
        "ppWeightKg",
        "ppHeartRate",
        "ppBMR",
        "ppBMI",
        "ppMusclePercentage",
        "ppMuscleKg",
        "ppProteinPercentage",
        "ppProteinKg",
        "ppWaterPercentage",
        "ppBodySkeletalKg",
        "ppBodyScore",
      ],
    },
    {
      name: "Energy",
      keys: [
        "ppWeightKg",
        "ppHeartRate",
        "ppBMR",
        "ppMusclePercentage",
        "ppMuscleKg",
        "ppProteinPercentage",
        "ppProteinKg",
        "ppWaterPercentage",
        "ppBodySkeletalKg",
        "ppBodyAge",
        "ppBodyScore",
      ],
    },
    {
      name: "Longevity",
      keys: [
        "ppWeightKg",
        "ppHeartRate",
        "ppBMR",
        "ppBMI",
        "ppFat",
        "ppFatKg",
        "ppMusclePercentage",
        "ppMuscleKg",
        "ppProteinPercentage",
        "ppProteinKg",
        "ppWaterPercentage",
        "ppBodyAge",
        "ppBodyScore",
      ],
    },
    {
      name: "Weight Loss",
      keys: [
        "ppWeightKg",
        "ppHeartRate",
        "ppBMR",
        "ppBMI",
        "ppFat",
        "ppFatKg",
        "ppMusclePercentage",
        "ppMuscleKg",
        "ppWaterPercentage",
        "ppBodyAge",
        "ppBodyScore",
      ],
    },
    {
      name: "Pain Relief",
      keys: [
        "ppHeartRate",
        "ppBMR",
        "ppFat",
        "ppFatKg",
        "ppMusclePercentage",
        "ppMuscleKg",
        "ppWaterPercentage",
        "ppBodySkeletalKg",
        "ppBodyScore",
      ],
    },
    {
      name: "General Health",
      keys: [
        "ppWeightKg",
        "ppHeartRate",
        "ppBMR",
        "ppBMI",
        "ppFat",
        "ppFatKg",
        "ppMusclePercentage",
        "ppMuscleKg",
        "ppProteinPercentage",
        "ppProteinKg",
        "ppWaterPercentage",
        "ppBodyAge",
        "ppBodyScore",
      ],
    },
  ];

  const defaultSummary = {
    header: "Tracking progress",
    body: "Progress tracking in progress...",
  };

  // Generate summaries for each goal: one in kg, one in lbs
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
