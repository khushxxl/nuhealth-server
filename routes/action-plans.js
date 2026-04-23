const express = require("express");
const router = express.Router();
const { OPENAI_API_KEY } = require("../config/constants");
const { getServiceClient } = require("../services/supabase");
const { success, error } = require("../utils/apiResponse");

// ─── Prompt Cache ─────────────────────────────────────────────────────────────

const promptCache = {};
let lastCacheTime = 0;
const CACHE_TTL = 60 * 1000;

async function getPrompt(id) {
  const now = Date.now();
  if (promptCache[id] && now - lastCacheTime < CACHE_TTL) {
    return promptCache[id];
  }

  const supabase = getServiceClient();
  if (!supabase) return promptCache[id] || null;

  try {
    const { data, error: err } = await supabase.from("ai_prompts").select("*");
    if (err) return promptCache[id] || null;
    for (const row of data) promptCache[row.id] = row;
    lastCacheTime = now;
  } catch (err) {
    console.error("Prompt fetch error:", err.message);
  }

  return promptCache[id] || null;
}

function interpolatePrompt(template, vars) {
  if (!template) return template;
  return template.replace(/\$\{(\w+(?:\.\w+)*)}/g, (match, key) => {
    return vars[key] !== undefined ? String(vars[key]) : match;
  });
}

// ─── OpenAI Helper ────────────────────────────────────────────────────────────

async function callOpenAI(messages, { model = "gpt-4o", temperature = 0.7, maxTokens } = {}) {
  const body = { model, messages, temperature };
  if (maxTokens) body.max_tokens = maxTokens;

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
  return data.choices[0].message.content.trim();
}

// ─── Helper: add days to a date string ────────────────────────────────────────

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/action-plans/generate
 * Body: { goal, answers, timelineWeeks, intensity }
 */
router.post("/action-plans/generate", async (req, res) => {
  try {
    const { goal, answers, timelineWeeks, intensity } = req.body;
    const userId = req.user.id;

    if (!goal || !timelineWeeks || !intensity) {
      return error(res, "goal, timelineWeeks, and intensity are required", 400);
    }

    const supabase = getServiceClient();
    if (!supabase) return error(res, "Database not configured", 500);

    // Deactivate any existing active plan
    await supabase
      .from("action_plans")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("status", "active");

    // Fetch prompt from Supabase
    const promptRow = await getPrompt("action-plan-generate");
    if (!promptRow) return error(res, "Action plan prompt not configured", 500);

    const vars = {
      goal,
      intensity,
      timelineWeeks: String(timelineWeeks),
      answers: JSON.stringify(answers),
    };

    const systemContent = promptRow.system_prompt;
    const userContent = interpolatePrompt(
      promptRow.user_prompt || promptRow.system_prompt,
      vars,
    );

    // Call OpenAI with retry for JSON parsing
    const MAX_RETRIES = 3;
    let attempts = 0;
    const messages = [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ];

    let planData = null;
    while (attempts < MAX_RETRIES) {
      try {
        const result = await callOpenAI(messages, {
          model: promptRow.model || "gpt-4o",
          temperature: promptRow.temperature ?? 0.7,
          maxTokens: promptRow.max_tokens || 2000,
        });
        planData = JSON.parse(result);
        break;
      } catch (parseErr) {
        attempts++;
        if (attempts < MAX_RETRIES) {
          messages.push({
            role: "user",
            content: "The last output was invalid JSON. Please return strictly valid JSON only.",
          });
        }
      }
    }

    if (!planData || !planData.weeklyTemplate) {
      return error(res, "Failed to generate action plan", 500);
    }

    // Calculate dates
    const startDate = new Date().toISOString().split("T")[0];
    const totalDays = timelineWeeks * 7;
    const endDate = addDays(startDate, totalDays - 1);

    // Insert plan
    const { data: insertedPlan, error: planErr } = await supabase
      .from("action_plans")
      .insert([{
        user_id: userId,
        goal,
        title: planData.title || goal.replace(/_/g, " "),
        answers: answers || {},
        timeline_weeks: timelineWeeks,
        intensity,
        status: "active",
        start_date: startDate,
        end_date: endDate,
      }])
      .select()
      .single();

    if (planErr) {
      console.error("Plan insert error:", planErr);
      return error(res, "Failed to save action plan", 500);
    }

    // Expand weekly template into daily tasks
    const tasksToInsert = [];
    const template = planData.weeklyTemplate;

    for (let day = 1; day <= totalDays; day++) {
      const dayOfWeek = ((day - 1) % 7) + 1; // 1-7
      const dayTasks = template[String(dayOfWeek)] || [];
      const taskDate = addDays(startDate, day - 1);

      dayTasks.forEach((label, idx) => {
        tasksToInsert.push({
          plan_id: insertedPlan.id,
          day_number: day,
          task_date: taskDate,
          label,
          sort_order: idx,
        });
      });
    }

    if (tasksToInsert.length > 0) {
      const { error: tasksErr } = await supabase
        .from("action_plan_tasks")
        .insert(tasksToInsert);

      if (tasksErr) {
        console.error("Tasks insert error:", tasksErr);
        // Plan created but tasks failed - still return the plan
      }
    }

    console.log(`✅ Action plan created: ${insertedPlan.id} with ${tasksToInsert.length} tasks`);

    return success(res, {
      planId: insertedPlan.id,
      title: insertedPlan.title,
      startDate: insertedPlan.start_date,
      endDate: insertedPlan.end_date,
      timelineWeeks,
    });
  } catch (err) {
    console.error("Action plan generate error:", err.message);
    return error(res, "Failed to generate action plan", 500);
  }
});

/**
 * GET /api/action-plans/current
 * Returns active plan with today's tasks
 */
router.get("/action-plans/current", async (req, res) => {
  try {
    const userId = req.user.id;
    const supabase = getServiceClient();
    if (!supabase) return error(res, "Database not configured", 500);

    // Get active plan
    const { data: plan, error: planErr } = await supabase
      .from("action_plans")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .single();

    if (planErr || !plan) {
      return success(res, { plan: null, todaysTasks: [] });
    }

    // Calculate progress
    const today = new Date().toISOString().split("T")[0];
    const startMs = new Date(plan.start_date).getTime();
    const todayMs = new Date(today).getTime();
    const dayNumber = Math.floor((todayMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
    const totalDays = plan.timeline_weeks * 7;
    const currentWeek = Math.ceil(dayNumber / 7);
    const progress = Math.min(Math.round((dayNumber / totalDays) * 100), 100);

    // Get today's tasks
    const { data: tasks, error: tasksErr } = await supabase
      .from("action_plan_tasks")
      .select("id, label, completed, sort_order")
      .eq("plan_id", plan.id)
      .eq("task_date", today)
      .order("sort_order", { ascending: true });

    return success(res, {
      plan: {
        id: plan.id,
        title: plan.title,
        goal: plan.goal,
        timelineWeeks: plan.timeline_weeks,
        intensity: plan.intensity,
        startDate: plan.start_date,
        endDate: plan.end_date,
        status: plan.status,
      },
      progress,
      currentWeek,
      dayNumber,
      totalDays,
      todaysTasks: tasks || [],
    });
  } catch (err) {
    console.error("Get current plan error:", err.message);
    return error(res, "Failed to fetch action plan", 500);
  }
});

/**
 * PATCH /api/action-plans/tasks/:taskId
 * Body: { completed: boolean }
 */
router.patch("/action-plans/tasks/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { completed } = req.body;
    const userId = req.user.id;
    const supabase = getServiceClient();
    if (!supabase) return error(res, "Database not configured", 500);

    // Verify task belongs to user
    const { data: task, error: taskErr } = await supabase
      .from("action_plan_tasks")
      .select("id, plan_id")
      .eq("id", taskId)
      .single();

    if (taskErr || !task) return error(res, "Task not found", 404);

    const { data: plan } = await supabase
      .from("action_plans")
      .select("user_id")
      .eq("id", task.plan_id)
      .single();

    if (!plan || plan.user_id !== userId) return error(res, "Unauthorized", 403);

    // Update task
    const { error: updateErr } = await supabase
      .from("action_plan_tasks")
      .update({
        completed: !!completed,
        completed_at: completed ? new Date().toISOString() : null,
      })
      .eq("id", taskId);

    if (updateErr) return error(res, "Failed to update task", 500);

    return success(res, { taskId, completed: !!completed });
  } catch (err) {
    console.error("Task toggle error:", err.message);
    return error(res, "Failed to update task", 500);
  }
});

/**
 * DELETE /api/action-plans/current
 * Soft-deletes the active plan
 */
router.delete("/action-plans/current", async (req, res) => {
  try {
    const userId = req.user.id;
    const supabase = getServiceClient();
    if (!supabase) return error(res, "Database not configured", 500);

    const { error: delErr } = await supabase
      .from("action_plans")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("status", "active");

    if (delErr) return error(res, "Failed to delete plan", 500);

    return success(res, null, "Plan deleted");
  } catch (err) {
    console.error("Delete plan error:", err.message);
    return error(res, "Failed to delete plan", 500);
  }
});

module.exports = router;
