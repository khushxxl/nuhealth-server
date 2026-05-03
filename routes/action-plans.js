const express = require("express");
const router = express.Router();
const { getServiceClient } = require("../services/supabase");
const { success, error } = require("../utils/apiResponse");
const { generateDailyTasks } = require("../services/daily-plan-generator");
const {
  scheduleDailyPlan,
  removeScheduledPlan,
  queueImmediateGeneration,
} = require("../services/plan-queue");
const { resolveTargetSpec } = require("../utils/planTargetParser");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

/**
 * Look up the user's most recent scale_measurement value for a given
 * body_param_key (e.g. "ppWeightKg"). Returns null if there's no data.
 */
async function getLatestMetricValue(supabase, userId, bodyParamKey) {
  if (!supabase || !userId || !bodyParamKey) return null;
  try {
    const { data, error: err } = await supabase
      .from("scale_measurements")
      .select(
        "current_value_num, scale_record_id, scale_records!inner(scale_user_id, created_at)",
      )
      .eq("body_param_key", bodyParamKey)
      .eq("scale_records.scale_user_id", userId)
      .order("scale_records(created_at)", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (err || !data) return null;
    const v = data.current_value_num;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Compute progress percentage (0-100) using:
 *   progress = (baseline - current) / (baseline - target) * 100   for decrease
 *   progress = (current - baseline) / (target - baseline) * 100   for increase
 *
 * Clamped to [0, 100]. Returns null if any input is missing or denominator is 0.
 */
function computeMetricProgress({ baseline, current, target, direction }) {
  if (
    typeof baseline !== "number" ||
    typeof current !== "number" ||
    typeof target !== "number"
  ) {
    return null;
  }
  const numerator =
    direction === "increase" ? current - baseline : baseline - current;
  const denominator =
    direction === "increase" ? target - baseline : baseline - target;
  if (denominator === 0) return null;
  const pct = (numerator / denominator) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/action-plans/generate
 * Body: { goal, answers, timelineWeeks, intensity, useWearables, planTime, timezone }
 */
router.post("/action-plans/generate", async (req, res) => {
  try {
    const { goal, answers, timelineWeeks, intensity, useWearables, planTime, timezone } = req.body;
    const userId = req.user.id;

    console.log("🎯 [ActionPlan] Generate request:", { userId, goal, timelineWeeks, intensity, useWearables, planTime });

    if (!goal || !timelineWeeks || !intensity) {
      return error(res, "goal, timelineWeeks, and intensity are required", 400);
    }

    const supabase = getServiceClient();
    if (!supabase) return error(res, "Database not configured", 500);

    // Deactivate any existing active plan + remove its schedule
    const { data: existingPlan } = await supabase
      .from("action_plans")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (existingPlan) {
      await supabase
        .from("action_plans")
        .update({ status: "deleted", updated_at: new Date().toISOString() })
        .eq("id", existingPlan.id);
      await removeScheduledPlan(existingPlan.id);
    }

    // Determine generation mode
    const generationMode = useWearables ? "wearable_triggered" : planTime ? "time_based" : "time_based";

    // Calculate dates
    const startDate = new Date().toISOString().split("T")[0];
    const totalDays = timelineWeeks * 7;
    const endDate = addDays(startDate, totalDays - 1);

    // Capture baseline + compute explicit target from questionnaire answer
    let baselineValue = null;
    let targetValue = null;
    let trackedMetricKey = null;
    let targetDirection = null;

    const targetSpec = resolveTargetSpec(goal, answers);
    if (targetSpec) {
      const baseline = await getLatestMetricValue(
        supabase,
        userId,
        targetSpec.trackedMetricKey,
      );
      if (typeof baseline === "number" && Number.isFinite(baseline)) {
        baselineValue = baseline;
        // Prefer absolute target from the questionnaire; fall back to applying
        // a delta to the baseline (legacy answer formats).
        if (typeof targetSpec.targetKg === "number") {
          targetValue = targetSpec.targetKg;
        } else if (typeof targetSpec.deltaKg === "number") {
          targetValue =
            targetSpec.direction === "decrease"
              ? Math.max(0, baseline - targetSpec.deltaKg)
              : baseline + targetSpec.deltaKg;
        }
        trackedMetricKey = targetSpec.trackedMetricKey;
        targetDirection = targetSpec.direction;
        console.log(
          `🎯 [ActionPlan] Baseline=${baselineValue}kg, target=${targetValue}kg (${targetDirection}) on ${trackedMetricKey}`,
        );
      } else {
        console.log(
          "[ActionPlan] No scale baseline found, progress will fall back to time-based",
        );
      }
    }

    // Insert plan
    const { data: plan, error: planErr } = await supabase
      .from("action_plans")
      .insert([{
        user_id: userId,
        goal,
        title: goal.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        answers: answers || {},
        timeline_weeks: timelineWeeks,
        intensity,
        status: "active",
        start_date: startDate,
        end_date: endDate,
        use_wearables: !!useWearables,
        plan_time: planTime || "07:00",
        generation_mode: generationMode,
        timezone: timezone || "UTC",
        baseline_value: baselineValue,
        target_value: targetValue,
        tracked_metric_key: trackedMetricKey,
        target_direction: targetDirection,
      }])
      .select()
      .single();

    if (planErr) {
      console.error("❌ [ActionPlan] Plan insert error:", planErr.message);
      return error(res, "Failed to save action plan: " + planErr.message, 500);
    }

    console.log("✅ [ActionPlan] Plan created:", plan.id, "mode:", generationMode);

    // Schedule recurring job for time-based plans
    if (generationMode === "time_based" && planTime) {
      await scheduleDailyPlan(userId, plan.id, planTime, timezone || "UTC");
    }

    // Generate Day 1 tasks immediately
    try {
      const genResult = await generateDailyTasks(userId, plan.id, "initial");
      console.log("✅ [ActionPlan] Day 1 generated:", genResult);
    } catch (genErr) {
      console.error("⚠️ [ActionPlan] Day 1 generation failed, queueing retry:", genErr.message);
      await queueImmediateGeneration(userId, plan.id, "initial");
    }

    return success(res, {
      planId: plan.id,
      title: plan.title,
      startDate: plan.start_date,
      endDate: plan.end_date,
      timelineWeeks,
      generationMode,
    });
  } catch (err) {
    console.error("❌ [ActionPlan] Generate error:", err.message);
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

    const { data: plan, error: planErr } = await supabase
      .from("action_plans")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (planErr || !plan) {
      return success(res, { plan: null, todaysTasks: [] });
    }

    const today = new Date().toISOString().split("T")[0];
    const startMs = new Date(plan.start_date).getTime();
    const todayMs = new Date(today).getTime();
    const dayNumber = Math.floor((todayMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
    const totalDays = plan.timeline_weeks * 7;
    const currentWeek = Math.ceil(dayNumber / 7);

    // Progress: prefer metric-based (baseline → target) when the plan tracks a
    // body composition metric. Falls back to time-based for goals without a
    // measurable scale signal (sleep, recovery) or when no baseline was captured.
    let progress = Math.min(Math.round((dayNumber / totalDays) * 100), 100);
    let progressSource = "time";
    let metricCurrentValue = null;

    if (plan.tracked_metric_key && plan.baseline_value != null && plan.target_value != null) {
      const current = await getLatestMetricValue(
        supabase,
        userId,
        plan.tracked_metric_key,
      );
      if (typeof current === "number") {
        metricCurrentValue = current;
        const metricProgress = computeMetricProgress({
          baseline: Number(plan.baseline_value),
          current,
          target: Number(plan.target_value),
          direction: plan.target_direction || "decrease",
        });
        if (metricProgress != null) {
          progress = metricProgress;
          progressSource = "metric";
        }
      }
    }

    // Get today's tasks
    const { data: tasks } = await supabase
      .from("action_plan_tasks")
      .select("id, label, completed, sort_order, category, rationale")
      .eq("plan_id", plan.id)
      .eq("task_date", today)
      .order("sort_order", { ascending: true });

    const hasTodaysTasks = tasks && tasks.length > 0;

    // Determine awaiting state
    let awaitingData = false;
    let awaitingMessage = "";

    if (!hasTodaysTasks && dayNumber > 1) {
      if (plan.generation_mode === "wearable_triggered") {
        awaitingData = true;
        awaitingMessage = "Waiting for your sleep data to generate today's plan...";
      } else if (plan.generation_mode === "time_based") {
        awaitingData = true;
        const timeStr = plan.plan_time?.slice(0, 5) || "07:00";
        awaitingMessage = `Your plan will be ready at ${timeStr}`;
      }
    }

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
        generationMode: plan.generation_mode,
        useWearables: plan.use_wearables,
        baselineValue: plan.baseline_value,
        targetValue: plan.target_value,
        trackedMetricKey: plan.tracked_metric_key,
        targetDirection: plan.target_direction,
        answers: plan.answers || {},
      },
      progress,
      progressSource, // "metric" | "time"
      metricCurrentValue,
      currentWeek,
      dayNumber,
      totalDays,
      todaysTasks: tasks || [],
      awaitingData,
      awaitingMessage,
    });
  } catch (err) {
    console.error("Get current plan error:", err.message);
    return error(res, "Failed to fetch action plan", 500);
  }
});

/**
 * POST /api/action-plans/generate-today
 * Manual trigger to generate today's tasks (fallback)
 */
router.post("/action-plans/generate-today", async (req, res) => {
  try {
    const userId = req.user.id;
    const supabase = getServiceClient();
    if (!supabase) return error(res, "Database not configured", 500);

    const { data: plan } = await supabase
      .from("action_plans")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!plan) return error(res, "No active plan found", 404);

    const result = await generateDailyTasks(userId, plan.id, "manual");
    return success(res, result);
  } catch (err) {
    console.error("Generate today error:", err.message);
    return error(res, "Failed to generate today's tasks", 500);
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
    const { data: task } = await supabase
      .from("action_plan_tasks")
      .select("id, plan_id")
      .eq("id", taskId)
      .single();

    if (!task) return error(res, "Task not found", 404);

    const { data: plan } = await supabase
      .from("action_plans")
      .select("user_id")
      .eq("id", task.plan_id)
      .single();

    if (!plan || plan.user_id !== userId) return error(res, "Unauthorized", 403);

    const { error: updateErr } = await supabase
      .from("action_plan_tasks")
      .update({
        completed: !!completed,
        completed_at: completed ? new Date().toISOString() : null,
      })
      .eq("id", taskId);

    if (updateErr) return error(res, "Failed to update task", 500);

    // Check if all tasks for today are now completed
    if (completed) {
      try {
        const today = new Date().toISOString().split("T")[0];
        const { data: todaysTasks } = await supabase
          .from("action_plan_tasks")
          .select("completed")
          .eq("plan_id", task.plan_id)
          .eq("task_date", today);

        if (todaysTasks?.length && todaysTasks.every((t) => t.completed)) {
          const liveUpdates = require("../services/live-updates");
          await liveUpdates.tasksCompleted(userId, todaysTasks.length);
        }
      } catch (err) {
        console.warn("[ActionPlan] Completion live update failed:", err.message);
      }
    }

    return success(res, { taskId, completed: !!completed });
  } catch (err) {
    console.error("Task toggle error:", err.message);
    return error(res, "Failed to update task", 500);
  }
});

/**
 * DELETE /api/action-plans/current
 * Soft-deletes the active plan and removes scheduled jobs
 */
router.delete("/action-plans/current", async (req, res) => {
  try {
    const userId = req.user.id;
    const supabase = getServiceClient();
    if (!supabase) return error(res, "Database not configured", 500);

    const { data: plan } = await supabase
      .from("action_plans")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (plan) {
      await removeScheduledPlan(plan.id);
      await supabase
        .from("action_plans")
        .update({ status: "deleted", updated_at: new Date().toISOString() })
        .eq("id", plan.id);
    }

    return success(res, null, "Plan deleted");
  } catch (err) {
    console.error("Delete plan error:", err.message);
    return error(res, "Failed to delete plan", 500);
  }
});

module.exports = router;
