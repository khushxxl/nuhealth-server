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
  console.log("   Set OPENAI_API_KEY environment variable");
}

/**
 * Generate AI summary for a goal card
 * @param {Object} params - Parameters for summary generation
 * @param {string} params.goalName - Name of the goal (e.g., "General Health")
 * @param {Object} params.currentMetrics - Current metric values
 * @param {Object} params.previousMetrics - Previous metric values (optional)
 * @param {Array} params.metricKeys - Array of metric keys for this goal
 * @returns {Promise<string|null>} Generated summary or null if failed
 */
async function generateGoalSummary({
  goalName,
  currentMetrics,
  previousMetrics = null,
  metricKeys,
}) {
  if (!openai) {
    console.log("⚠️  OpenAI not configured - skipping summary generation");
    return null;
  }

  try {
    // Build metric comparison text
    let metricsText = "Current metrics:\n";
    metricKeys.forEach((key) => {
      const current = currentMetrics[key];
      if (current !== null && current !== undefined) {
        metricsText += `- ${key}: ${current}\n`;
      }
    });

    if (previousMetrics) {
      metricsText += "\nPrevious metrics (for comparison):\n";
      metricKeys.forEach((key) => {
        const previous = previousMetrics[key];
        if (previous !== null && previous !== undefined) {
          metricsText += `- ${key}: ${previous}\n`;
        }
      });
    }

    const prompt = `You are a health and wellness coach. Generate a brief, encouraging 2-line summary about the user's progress for the "${goalName}" goal based on their body composition metrics.

${metricsText}

Generate exactly 2 lines that:
1. Are encouraging and positive
2. Highlight key improvements or areas of focus based on the metrics
3. Are concise and easy to understand (each line should be 10-15 words max)
4. Focus on progress and motivation
5. If previous metrics are provided, compare and highlight trends

Format as two separate lines, no bullet points or numbering. Each line should be a complete, meaningful sentence.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful health and wellness coach that provides encouraging, concise feedback about body composition metrics.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    const summary = response.choices[0]?.message?.content?.trim();
    if (summary) {
      // Split into 2 lines if needed
      const lines = summary.split("\n").filter((line) => line.trim());
      return lines.slice(0, 2).join("\n");
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
 * @param {Object} previousMetrics - Previous metric values (optional)
 * @returns {Promise<Object>} Object with summaries for each goal
 */
async function generateAllGoalSummaries(
  currentMetrics,
  previousMetrics = null
) {
  const summaries = {};

  // Goal card configurations
  const goalConfigs = [
    {
      name: "General Health",
      keys: ["ppBodyScore", "ppBodyAge", "ppWeightKg"],
    },
    {
      name: "Recovery",
      keys: ["ppBodyScore", "ppMusclePercentage", "ppWaterPercentage"],
    },
    {
      name: "Energy",
      keys: ["ppBMR", "ppMusclePercentage", "ppProteinPercentage"],
    },
    {
      name: "Longevity",
      keys: ["ppBodyScore", "ppBodyAge", "ppFat"],
    },
    {
      name: "Weight Loss",
      keys: ["ppWeightKg", "ppBMI", "ppFat"],
    },
    {
      name: "Pain Relief",
      keys: ["ppMuscleKg", "ppBodySkeletalKg", "ppProteinKg"],
    },
  ];

  // Generate summaries for each goal
  for (const config of goalConfigs) {
    const summary = await generateGoalSummary({
      goalName: config.name,
      currentMetrics,
      previousMetrics,
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
