const { OPENAI_API_KEY } = require("../config/constants");
const { getServiceClient } = require("./supabase");
const { sendPushNotification } = require("./notification");
const healthMetrics = require("./health-metrics");

// ─── Prompt Cache ─────────────────────────────────────────────────────────────

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
    console.error("[DailyPlan] Prompt fetch error:", err.message);
  }

  return promptCache[id] || null;
}

// ─── OpenAI Helper ────────────────────────────────────────────────────────────

async function callOpenAI(messages, { model = "gpt-4o", temperature = 0.7, maxTokens = 1000 } = {}) {
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

function interpolatePrompt(template, vars) {
  if (!template) return template;
  return template.replace(/\$\{(\w+(?:\.\w+)*)}/g, (match, key) => {
    return vars[key] !== undefined ? String(vars[key]) : match;
  });
}

// ─── Health Context Gathering ─────────────────────────────────────────────────

async function gatherHealthContext(userId, supabase) {
  const context = {
    sleep: null,
    activity: null,
    recovery: null,
    physiology: null,
    scale: null,
    checkin: null,
    yesterdayCompletion: "No data",
  };

  try {
    // Last 7 days of health metrics by category
    const [sleepData, activityData, recoveryData, physiologyData] = await Promise.all([
      healthMetrics.getLatest(userId, { category: "sleep", limit: 20 }).catch(() => null),
      healthMetrics.getLatest(userId, { category: "activity", limit: 20 }).catch(() => null),
      healthMetrics.getLatest(userId, { category: "recovery", limit: 10 }).catch(() => null),
      healthMetrics.getLatest(userId, { category: "physiology", limit: 10 }).catch(() => null),
    ]);

    if (sleepData?.length) {
      context.sleep = sleepData.map((m) => ({
        key: m.metric_key,
        value: m.value_num,
        unit: m.unit,
        date: m.recorded_at,
      }));
    }
    if (activityData?.length) {
      context.activity = activityData.map((m) => ({
        key: m.metric_key,
        value: m.value_num,
        unit: m.unit,
        date: m.recorded_at,
      }));
    }
    if (recoveryData?.length) {
      context.recovery = recoveryData.map((m) => ({
        key: m.metric_key,
        value: m.value_num,
        unit: m.unit,
      }));
    }
    if (physiologyData?.length) {
      context.physiology = physiologyData.map((m) => ({
        key: m.metric_key,
        value: m.value_num,
        unit: m.unit,
      }));
    }

    // Latest scale record
    const { data: scaleRecord } = await supabase
      .from("scale_records")
      .select("mutated_response, created_at")
      .eq("scale_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (scaleRecord?.mutated_response) {
      const bodyData = scaleRecord.mutated_response;
      const keyMetrics = ["ppWeightKg", "ppFat", "ppMuscleKg", "ppBMI", "ppBodyScore", "ppBodyAge"];
      context.scale = bodyData
        .filter((item) => keyMetrics.includes(item.bodyParamKey || item.body_param_key))
        .map((item) => ({
          key: item.bodyParamKey || item.body_param_key,
          value: item.currentValue ?? item.current_value,
          name: item.bodyParamName || item.body_param_name,
        }));
    }

    // Latest check-in
    const { data: checkin } = await supabase
      .from("personalization")
      .select("checkin_results")
      .eq("userid", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (checkin?.checkin_results?.length) {
      const latest = checkin.checkin_results[checkin.checkin_results.length - 1];
      context.checkin = latest;
    }

    // Yesterday's task completion
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const { data: yesterdayTasks } = await supabase
      .from("action_plan_tasks")
      .select("completed")
      .eq("task_date", yesterdayStr)
      .eq("plan_id", (
        await supabase
          .from("action_plans")
          .select("id")
          .eq("user_id", userId)
          .eq("status", "active")
          .maybeSingle()
      ).data?.id);

    if (yesterdayTasks?.length) {
      const completed = yesterdayTasks.filter((t) => t.completed).length;
      context.yesterdayCompletion = `${completed}/${yesterdayTasks.length} tasks completed`;
    }
  } catch (err) {
    console.error("[DailyPlan] Error gathering health context:", err.message);
  }

  return context;
}

// ─── Core: Generate Daily Tasks ───────────────────────────────────────────────

async function generateDailyTasks(userId, planId, triggerType) {
  const supabase = getServiceClient();
  if (!supabase) throw new Error("Database not configured");

  console.log(`🎯 [DailyPlan] Generating for user=${userId} plan=${planId} trigger=${triggerType}`);

  // 1. Get the plan
  const { data: plan, error: planErr } = await supabase
    .from("action_plans")
    .select("*")
    .eq("id", planId)
    .eq("status", "active")
    .single();

  if (planErr || !plan) {
    console.log("[DailyPlan] No active plan found");
    return { success: false, reason: "No active plan" };
  }

  // 2. Calculate day number
  const today = new Date().toISOString().split("T")[0];
  const startMs = new Date(plan.start_date).getTime();
  const todayMs = new Date(today).getTime();
  const dayNumber = Math.floor((todayMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
  const totalDays = plan.timeline_weeks * 7;
  const currentWeek = Math.ceil(dayNumber / 7);

  // Check if plan has expired
  if (dayNumber > totalDays) {
    console.log("[DailyPlan] Plan expired, marking completed");
    await supabase
      .from("action_plans")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", planId);
    return { success: false, reason: "Plan completed" };
  }

  // 3. Idempotency check
  const { data: existing } = await supabase
    .from("daily_plan_generations")
    .select("id")
    .eq("plan_id", planId)
    .eq("task_date", today)
    .maybeSingle();

  if (existing) {
    console.log("[DailyPlan] Already generated for today, skipping");
    return { success: true, reason: "Already generated", skipped: true };
  }

  // 4. Gather health context
  console.log("[DailyPlan] Gathering health context...");
  const healthContext = await gatherHealthContext(userId, supabase);

  // 5. Get AI prompt
  const promptRow = await getPrompt("daily-plan-generate");
  if (!promptRow) {
    console.error("[DailyPlan] Prompt 'daily-plan-generate' not found");
    throw new Error("Daily plan prompt not configured");
  }

  const vars = {
    goal: plan.goal,
    intensity: plan.intensity,
    dayNumber: String(dayNumber),
    totalDays: String(totalDays),
    currentWeek: String(currentWeek),
    answers: JSON.stringify(plan.answers),
    healthContext: JSON.stringify(healthContext, null, 2),
    yesterdayCompletion: healthContext.yesterdayCompletion,
  };

  const systemContent = promptRow.system_prompt;
  const userContent = interpolatePrompt(promptRow.user_prompt, vars);

  // 6. Call OpenAI with retries
  console.log("[DailyPlan] Calling OpenAI...");
  const MAX_RETRIES = 3;
  let attempts = 0;
  const messages = [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];

  let result = null;
  while (attempts < MAX_RETRIES) {
    try {
      const raw = await callOpenAI(messages, {
        model: promptRow.model || "gpt-4o",
        temperature: promptRow.temperature ?? 0.7,
        maxTokens: promptRow.max_tokens || 1000,
      });
      result = JSON.parse(raw);
      break;
    } catch (err) {
      attempts++;
      console.log(`[DailyPlan] Attempt ${attempts} failed: ${err.message}`);
      if (attempts < MAX_RETRIES) {
        messages.push({
          role: "user",
          content: "Invalid JSON. Return strictly valid JSON matching the schema.",
        });
      }
    }
  }

  if (!result || !result.tasks || !Array.isArray(result.tasks)) {
    console.error("[DailyPlan] Failed to get valid tasks from OpenAI");
    throw new Error("Failed to generate daily tasks");
  }

  // 7. Insert tasks
  const tasksToInsert = result.tasks.map((task, idx) => ({
    plan_id: planId,
    day_number: dayNumber,
    task_date: today,
    label: task.label,
    sort_order: task.sort_order ?? idx,
  }));

  const { error: insertErr } = await supabase
    .from("action_plan_tasks")
    .insert(tasksToInsert);

  if (insertErr) {
    console.error("[DailyPlan] Task insert error:", insertErr.message);
    throw new Error("Failed to save tasks");
  }

  // 8. Record the generation
  await supabase.from("daily_plan_generations").insert([{
    plan_id: planId,
    user_id: userId,
    task_date: today,
    day_number: dayNumber,
    trigger_type: triggerType,
    health_context: healthContext,
    tasks_generated: tasksToInsert.length,
  }]);

  // 9. Send push notification
  const { data: user } = await supabase
    .from("users")
    .select("notification_id")
    .eq("id", userId)
    .single();

  if (user?.notification_id) {
    const sleepScore = healthContext.sleep?.find((m) => m.key === "sleep_score")?.value;
    const title = "Your daily plan is ready";
    const body = sleepScore
      ? `Based on your sleep score of ${Math.round(sleepScore)}. ${tasksToInsert.length} tasks today.`
      : `${tasksToInsert.length} tasks ready for today.`;

    await sendPushNotification(user.notification_id, title, body).catch((err) =>
      console.warn("[DailyPlan] Push notification failed:", err.message)
    );
  }

  console.log(`✅ [DailyPlan] Generated ${tasksToInsert.length} tasks for day ${dayNumber}`);

  return {
    success: true,
    tasksGenerated: tasksToInsert.length,
    dayNumber,
    healthInsight: result.healthInsight || null,
  };
}

module.exports = { generateDailyTasks, gatherHealthContext };
