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

/**
 * Calculate percentage change between two values
 */
function calculatePercentageChange(oldValue, newValue) {
  if (!oldValue || oldValue === 0) return null;
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Format metric value with unit
 */
function formatMetricValue(key, value) {
  if (value === null || value === undefined) return null;

  // Map common units
  const unitMap = {
    ppWeightKg: "lb",
    ppBMI: "",
    ppHeartRate: "bpm",
    ppBMR: "kcal",
    ppMuscleKg: "lb",
    ppFat: "%",
    ppBodyScore: "points",
    ppBodyAge: "years",
  };

  const unit = unitMap[key] || "";
  return unit ? `${value} ${unit}` : value.toString();
}

/**
 * Build metrics comparison text for prompt
 */
function buildMetricsComparisonText(
  currentMetrics,
  twoWeeksAgoMetrics,
  metricKeys
) {
  let text = "Current metrics (today):\n";
  const changes = [];

  metricKeys.forEach((key) => {
    const current = currentMetrics[key];
    const twoWeeksAgo = twoWeeksAgoMetrics?.[key];

    if (current !== null && current !== undefined) {
      text += `- ${key}: ${formatMetricValue(key, current)}`;

      if (twoWeeksAgo !== null && twoWeeksAgo !== undefined) {
        const change = current - twoWeeksAgo;
        const percentChange = calculatePercentageChange(twoWeeksAgo, current);

        text += ` (was ${formatMetricValue(key, twoWeeksAgo)})`;

        if (percentChange !== null) {
          changes.push({
            key,
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
 * Generate AI summary for a goal card with header and body
 * @param {Object} params - Parameters for summary generation
 * @param {string} params.goalName - Name of the goal (e.g., "General Health")
 * @param {Object} params.currentMetrics - Current metric values
 * @param {Object} params.twoWeeksAgoMetrics - Metrics from two weeks ago (optional)
 * @param {Array} params.metricKeys - Array of metric keys for this goal
 * @returns {Promise<Object|null>} Generated summary with header and body or null if failed
 */
async function generateGoalSummary({
  goalName,
  currentMetrics,
  twoWeeksAgoMetrics = null,
  metricKeys,
}) {
  if (!openai) {
    console.log("⚠️  OpenAI not configured - skipping summary generation");
    return null;
  }

  try {
    const metricsText = buildMetricsComparisonText(
      currentMetrics,
      twoWeeksAgoMetrics,
      metricKeys
    );

    const prompt = `You are a health and wellness coach. Generate a summary for the "${goalName}" goal card based on body composition metrics from the last two weeks.

${metricsText}

Generate a summary with:
1. HEADER: A short, encouraging header (25-35 characters including spaces). Examples: "Your overall trends this week", "Recovery score on the rise", "Daily energy adapting well"

2. BODY: A 2-line summary (160-190 characters total, or up to 220-240 if 3 lines needed) that:
   - Reviews trends over the last two weeks
   - Uses specific numbers with units (lbs, %, bpm, kcal, points, etc.)
   - Celebrates wins and improvements
   - Encourages on areas needing attention
   - Contextualizes why changes relate to the goal
   - Mentions "over the last two weeks" or "in the past two weeks"
   - Focuses on well-known metrics but doesn't ignore lesser-known ones
   - Uses percentage changes and quantity changes (e.g., "by about X lb (Y%)")

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
          // Combine header and body into a single string
          return `${parsed.header.trim()}\n${parsed.body.trim()}`;
        }
      } catch (parseError) {
        console.error(`❌ Error parsing JSON for ${goalName}:`, parseError);
        // Fallback: use the content as-is
        return content;
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

  // Generate summaries for each goal
  for (const config of goalConfigs) {
    const summary = await generateGoalSummary({
      goalName: config.name,
      currentMetrics,
      twoWeeksAgoMetrics,
      metricKeys: config.keys,
    });

    summaries[config.name] = summary || "Progress tracking in progress...";
  }

  return summaries;
}

module.exports = {
  generateGoalSummary,
  generateAllGoalSummaries,
  isOpenAIConfigured: () => openai !== null,
};
