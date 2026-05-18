const { getServiceClient } = require("./supabase");
const healthMetrics = require("./health-metrics");

// Body-param keys we surface in the snapshot — names mirror what's stored
// in scale_records.mutated_response items.
const SCALE_KEYS = {
  ppWeightKg: "Weight",
  ppFat: "Body fat %",
  ppMuscleKg: "Muscle mass",
  ppMusclePercentage: "Muscle %",
  ppBodyFatKg: "Fat mass",
  ppBMI: "BMI",
  ppBodyScore: "Body score",
  ppBodyAge: "Body age",
  ppWaterPercentage: "Water %",
  ppVisceralFat: "Visceral fat",
};

const fmt = (n, digits = 1) =>
  n == null || Number.isNaN(n) ? null : Number(n).toFixed(digits);

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// Average a list of numbers, ignoring null/undefined.
function avg(nums) {
  const clean = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

// Pull body-data items from the latest two scale records and compute deltas.
async function getBodyComposition(supabase, userId) {
  const { data: records } = await supabase
    .from("scale_records")
    .select("mutated_response, created_at")
    .eq("scale_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(15);

  if (!records?.length) return null;

  const latest = records[0];
  // Pick a record ~30 days back, falling back to the oldest we have.
  const baselineCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const baseline =
    records.find((r) => new Date(r.created_at).getTime() <= baselineCutoff) ||
    records[records.length - 1];

  const valueOf = (record, key) => {
    const arr = Array.isArray(record?.mutated_response)
      ? record.mutated_response
      : [];
    const item = arr.find(
      (i) => (i.bodyParamKey || i.body_param_key) === key,
    );
    if (!item) return null;
    const v = item.currentValue ?? item.current_value;
    return typeof v === "number" ? v : Number(v) || null;
  };

  const rows = [];
  for (const [key, label] of Object.entries(SCALE_KEYS)) {
    const current = valueOf(latest, key);
    if (current == null) continue;
    const baselineVal = valueOf(baseline, key);
    const delta =
      typeof baselineVal === "number" ? current - baselineVal : null;
    rows.push({ key, label, current, delta });
  }

  return {
    asOf: latest.created_at,
    baselineAsOf: baseline.created_at,
    rows,
  };
}

// Average wearable signals over the last 7 days for a few headline metrics.
async function getWearable7d(userId) {
  const want = [
    "sleep_score",
    "sleep_total",
    "sleep_efficiency",
    "hrv",
    "hr_resting",
    "steps",
    "calories_active",
    "strain_score",
    "recovery_score",
  ];

  const out = {};
  for (const key of want) {
    try {
      const trend = await healthMetrics.getTrend(userId, key, 7);
      const values = (trend || [])
        .map((p) => p.value_num)
        .filter((v) => typeof v === "number");
      if (values.length) {
        out[key] = {
          avg: avg(values),
          last: values[values.length - 1],
          count: values.length,
        };
      }
    } catch {
      // skip — metric not present for this user
    }
  }
  return out;
}

async function getActiveGoal(supabase, userId) {
  const { data } = await supabase
    .from("user_goals")
    .select("*")
    .eq("userid", userId)
    .maybeSingle();
  return data || null;
}

async function getActivePlan(supabase, userId) {
  const { data: plan } = await supabase
    .from("action_plans")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (!plan) return null;

  const today = new Date().toISOString().split("T")[0];
  const { data: tasks } = await supabase
    .from("action_plan_tasks")
    .select("label, category, completed")
    .eq("plan_id", plan.id)
    .eq("task_date", today);

  const startMs = new Date(plan.start_date).getTime();
  const todayMs = new Date(today).getTime();
  const dayNumber =
    Math.floor((todayMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
  const totalDays = plan.timeline_weeks * 7;

  return {
    goal: plan.goal,
    intensity: plan.intensity,
    currentWeek: Math.ceil(dayNumber / 7),
    totalWeeks: plan.timeline_weeks,
    dayNumber,
    totalDays,
    tasks: tasks || [],
  };
}

async function getRecentLiveUpdates(supabase, userId, days = 5) {
  const since = isoDaysAgo(days);
  const { data } = await supabase
    .from("live_updates")
    .select("category, message, created_at")
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(15);
  return data || [];
}

async function getProfile(supabase, userId) {
  const { data } = await supabase
    .from("users")
    .select(
      "name, age, gender, height, weight, onboarding_answers, subscription_status",
    )
    .eq("id", userId)
    .maybeSingle();
  return data || null;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatProfile(p) {
  if (!p) return "PROFILE: unknown";
  const bits = [];
  if (p.age != null) bits.push(`${p.age}y`);
  if (p.gender) bits.push(p.gender);
  if (p.height != null) bits.push(`${p.height}cm`);
  if (p.weight != null) bits.push(`${p.weight}kg`);
  return `PROFILE: ${bits.length ? bits.join(", ") : "limited info"}`;
}

function formatBody(body) {
  if (!body || !body.rows.length) return "BODY: no scale data";
  const head = `BODY (latest ${new Date(body.asOf).toLocaleDateString("en-US", { month: "short", day: "numeric" })}, Δ vs ${new Date(body.baselineAsOf).toLocaleDateString("en-US", { month: "short", day: "numeric" })}):`;
  const lines = body.rows.map((r) => {
    const arrow =
      r.delta == null ? "" : r.delta > 0 ? " ↑" : r.delta < 0 ? " ↓" : "";
    const deltaStr =
      r.delta == null
        ? ""
        : ` (${r.delta > 0 ? "+" : ""}${fmt(r.delta, 1)}${arrow})`;
    return `  ${r.label}: ${fmt(r.current, 1)}${deltaStr}`;
  });
  return [head, ...lines].join("\n");
}

function formatWearable(w) {
  const labels = {
    sleep_score: ["Sleep score", ""],
    sleep_total: ["Sleep total", "h"],
    sleep_efficiency: ["Sleep efficiency", "%"],
    hrv: ["HRV", "ms"],
    hr_resting: ["Resting HR", "bpm"],
    steps: ["Steps", ""],
    calories_active: ["Active kcal", ""],
    strain_score: ["Strain", ""],
    recovery_score: ["Recovery", ""],
  };
  const lines = Object.entries(w)
    .map(([key, val]) => {
      const [label, unit] = labels[key] || [key, ""];
      // sleep_total may already be in seconds — convert if so
      let avgVal = val.avg;
      let lastVal = val.last;
      if (key === "sleep_total" && avgVal > 24) {
        avgVal = avgVal / 3600;
        lastVal = lastVal / 3600;
      }
      const isStep =
        key === "steps" || key === "calories_active";
      const fmtVal = isStep
        ? Math.round(avgVal).toLocaleString("en-US")
        : fmt(avgVal, 1);
      const fmtLast = isStep
        ? Math.round(lastVal).toLocaleString("en-US")
        : fmt(lastVal, 1);
      return `  ${label}: ${fmtVal}${unit} avg (latest ${fmtLast}${unit}, n=${val.count}/7)`;
    });
  if (!lines.length) return "WEARABLE (7d): no data";
  return ["WEARABLE (7d avg):", ...lines].join("\n");
}

function formatGoal(g) {
  if (!g) return "GOAL: none set";
  const headline = [];
  if (g.weight != null) headline.push(`weight target ${g.weight}kg`);
  if (g.bmi != null) headline.push(`BMI target ${g.bmi}`);
  if (g.bodyAge != null) headline.push(`body age target ${g.bodyAge}`);
  if (!headline.length) return "GOAL: none set";
  return `GOAL: ${headline.join(", ")}`;
}

function formatPlan(p) {
  if (!p) return "ACTIVE PLAN: none";
  const tasksLine = !p.tasks.length
    ? "  Today's tasks: none yet"
    : `  Today's tasks (${p.tasks.filter((t) => t.completed).length}/${p.tasks.length} done):\n${p.tasks
        .map(
          (t) =>
            `    ${t.completed ? "✓" : "·"} [${t.category || "general"}] ${t.label}`,
        )
        .join("\n")}`;
  return [
    `ACTIVE PLAN: ${p.goal} (${p.intensity}), week ${p.currentWeek}/${p.totalWeeks}, day ${p.dayNumber}/${p.totalDays}`,
    tasksLine,
  ].join("\n");
}

function formatLiveUpdates(updates) {
  if (!updates.length) return "RECENT SIGNALS (5d): none";
  const lines = updates.slice(0, 8).map((u) => {
    const when = new Date(u.created_at);
    const day = when.toLocaleDateString("en-US", {
      weekday: "short",
    });
    return `  [${day}, ${u.category}] ${u.message}`;
  });
  return ["RECENT SIGNALS (5d):", ...lines].join("\n");
}

function formatOnboarding(answers) {
  // Pick a few high-signal questions and surface as plain bullets so the model
  // doesn't waste tokens parsing a JSON blob.
  const arr = Array.isArray(answers) ? answers[0] : answers;
  if (!arr || typeof arr !== "object") return "ONBOARDING: no responses";
  const keys = [
    "What's your primary wellness goal?",
    "How often do you exercise?",
    "What's your typical stress level?",
    "How would you rate your sleep quality?",
    "How would you describe your current eating pattern?",
    "Have you experienced significant weight changes in the past 6 months?",
    "Do you have concerns about specific health risks?",
    "Would you prefer gentle encouragement or tough love?",
  ];
  const bullets = keys
    .map((k) => (arr[k] ? `  - ${k.replace(/\?$/, "")}: ${arr[k]}` : null))
    .filter(Boolean);
  if (!bullets.length) return "ONBOARDING: no responses";
  return ["ONBOARDING:", ...bullets].join("\n");
}

// ─── Public ──────────────────────────────────────────────────────────────────

/**
 * Build a structured, human-readable snapshot of the user's current health
 * state. Intended to be injected as the system message preamble for RAI chat
 * so the model grounds its advice in actual numbers instead of inventing.
 *
 * Returns { text, raw } — text is what goes to the prompt; raw is available
 * if the caller wants to do anything programmatic with the components.
 */
async function buildUserHealthSnapshot(userId) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { text: "USER SNAPSHOT: data unavailable", raw: null };
  }

  const [profile, body, wearable, goal, plan, updates] = await Promise.all([
    getProfile(supabase, userId).catch(() => null),
    getBodyComposition(supabase, userId).catch(() => null),
    getWearable7d(userId).catch(() => ({})),
    getActiveGoal(supabase, userId).catch(() => null),
    getActivePlan(supabase, userId).catch(() => null),
    getRecentLiveUpdates(supabase, userId).catch(() => []),
  ]);

  const sections = [
    "=== USER SNAPSHOT ===",
    formatProfile(profile),
    formatBody(body),
    formatWearable(wearable),
    formatGoal(goal),
    formatPlan(plan),
    formatLiveUpdates(updates),
    formatOnboarding(profile?.onboarding_answers),
    "=== END SNAPSHOT ===",
  ];

  return {
    text: sections.join("\n\n"),
    raw: { profile, body, wearable, goal, plan, updates },
  };
}

module.exports = { buildUserHealthSnapshot };
