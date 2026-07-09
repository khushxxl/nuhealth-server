/**
 * Scoring data builder — turns Supabase rows into the inputs the scoring engine
 * expects (field names per services/scoring/config.js FIELDS).
 *
 * Sources (verified against the live schema):
 *   - scale metrics:  scale_measurements.current_value_num  by body_param_key,
 *                     joined via scale_record_id → scale_records, dated by
 *                     scale_records.created_at (there is no scale_taken_at).
 *   - wearable metrics: health_metrics.value_num by metric_key, dated by
 *                     recorded_at, source-priority picked across oura/whoop/
 *                     8sleep/apple_health.
 *   - profile:        users (age, gender, height[cm], weight, user_body_type).
 *
 * Not ingested anywhere (engine treats as missing → those pillars sit out):
 *   HRV, VO2max, whoop recovery_score, active/met minutes, mindfulness,
 *   hr_recovery, high-HR-zone minutes, activity scores, muscle_quality_index.
 */

// Bare minimum for the Predictive page to unlock: a single BIA scan already
// yields a real (low-confidence) Weight / Body-composition / Body-Age score.
// Each score then matures on its own schedule (per-card baseline_status), and
// Lifestyle stays "building" until it has 28 days. See the scoring master doc's
// "minimum scans before results show" table.
const MIN_SCANS = 1;

// engine field → scale_measurements.body_param_key
const SCALE_MAP = {
  weight_kg: "ppWeightKg",
  fat_ratio_pct: "ppFat",
  fat_mass_kg: "ppBodyfatKg", // note lowercase f
  muscle_rate_pct: "ppMusclePercentage",
  skeletal_muscle_mass_kg: "ppBodySkeletalKg",
  visceral_fat: "ppVisceralFat",
  trunk_fat_ratio_pct: "ppBodyFatRateTrunk",
  body_age_years: "ppBodyAge",
  recommended_calorie_intake: "ppDCI",
  left_arm_muscle_mass_kg: "ppMuscleKgLeftArm",
  right_arm_muscle_mass_kg: "ppMuscleKgRightArm",
  left_leg_muscle_mass_kg: "ppMuscleKgLeftLeg",
  right_leg_muscle_mass_kg: "ppMuscleKgRightLeg",
  trunk_muscle_mass_kg: "ppMuscleKgTrunk",
};
const SCALE_PARAM_KEYS = Object.values(SCALE_MAP);

// engine field → { key: health_metrics.metric_key, div?: unit divisor }
const WEARABLE_MAP = {
  resting_heart_rate_bpm: { key: "hr_resting" },
  sleep_rhr_bpm: { key: "sleep_hr_lowest" }, // falls back to sleep_hr_avg
  steps: { key: "steps" },
  sleep_duration_min: { key: "sleep_total", div: 60 }, // stored in seconds
  deep_sleep_min: { key: "sleep_deep", div: 60 },
  rem_sleep_min: { key: "sleep_rem", div: 60 },
  sleep_efficiency_pct: { key: "sleep_efficiency" },
  sleep_score_0_100: { key: "sleep_score" },
  readiness_score_0_100: { key: "readiness_score" },
  respiratory_rate_brpm: { key: "respiratory_rate" },
  spo2_pct: { key: "spo2" },
};
const WEARABLE_METRIC_KEYS = [
  ...new Set([...Object.values(WEARABLE_MAP).map((v) => v.key), "sleep_hr_avg"]),
];

const SLEEP_KEYS = new Set([
  "sleep_total", "sleep_deep", "sleep_rem", "sleep_efficiency",
  "sleep_score", "sleep_hr_lowest", "sleep_hr_avg",
]);
const PRIORITY_SLEEP = ["oura", "8sleep", "whoop", "apple_health"];
const PRIORITY_GENERAL = ["oura", "whoop", "8sleep", "apple_health"];
function sourceRank(source, metricKey) {
  const list = SLEEP_KEYS.has(metricKey) ? PRIORITY_SLEEP : PRIORITY_GENERAL;
  const i = list.indexOf(String(source || "").toLowerCase());
  return i === -1 ? 99 : i;
}

const dayOf = (ts) => String(ts).slice(0, 10);

/**
 * Distinct scan-DAYS this user has (multiple same-day scans collapse to one).
 * Gates insights at >= MIN_SCANS.
 */
async function getScanCount(supabase, userId) {
  try {
    const { data } = await supabase
      .from("scale_records")
      .select("created_at")
      .eq("scale_user_id", userId);
    if (!data) return 0;
    return new Set(data.map((r) => dayOf(r.created_at))).size;
  } catch {
    return 0;
  }
}

/**
 * Build { today, historyRows, profile } for the engine. Returns null when the
 * user has no usable history.
 */
async function buildScoringInputs(supabase, userId, { windowDays = 120 } = {}) {
  const { data: u } = await supabase
    .from("users")
    .select("age, gender, height, weight, user_body_type")
    .eq("id", userId)
    .maybeSingle();
  if (!u) return null;

  const profile = {
    age_years: u.age ?? null,
    sex: u.gender ? String(u.gender).toLowerCase() : null, // "male" | "female"
    height_cm: u.height ?? null, // already cm
    weight_kg: u.weight ?? null,
    body_type: u.user_body_type ?? null,
  };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffIso = cutoff.toISOString();

  // ---- scale: per-day composition (latest scan of the day wins) ----
  const { data: recs } = await supabase
    .from("scale_records")
    .select("id, created_at")
    .eq("scale_user_id", userId)
    .gte("created_at", cutoffIso)
    .order("created_at", { ascending: true });

  const dayScale = {};
  if (recs && recs.length) {
    const recIds = recs.map((r) => r.id);
    const measByRec = {};
    for (let i = 0; i < recIds.length; i += 400) {
      const chunk = recIds.slice(i, i + 400);
      const { data } = await supabase
        .from("scale_measurements")
        .select("scale_record_id, body_param_key, current_value_num")
        .in("scale_record_id", chunk)
        .in("body_param_key", SCALE_PARAM_KEYS);
      for (const m of data || []) {
        (measByRec[m.scale_record_id] ||= {})[m.body_param_key] =
          m.current_value_num;
      }
    }
    // ascending order → later (more recent) same-day scan overwrites earlier.
    for (const r of recs) {
      const vals = measByRec[r.id];
      if (!vals) continue;
      const row = (dayScale[dayOf(r.created_at)] ||= {});
      for (const [field, key] of Object.entries(SCALE_MAP)) {
        if (vals[key] != null) row[field] = vals[key];
      }
    }
  }

  // ---- wearables: per-day, source-priority picked ----
  const { data: hm } = await supabase
    .from("health_metrics")
    .select("metric_key, value_num, recorded_at, source")
    .eq("user_id", userId)
    .in("metric_key", WEARABLE_METRIC_KEYS)
    .gte("recorded_at", cutoffIso);

  const bestByDay = {}; // date → metric_key → { value, rank }
  const sourcesByDay = {}; // date → source → count
  for (const r of hm || []) {
    const d = dayOf(r.recorded_at);
    const dm = (bestByDay[d] ||= {});
    const rk = sourceRank(r.source, r.metric_key);
    if (!dm[r.metric_key] || rk < dm[r.metric_key].rank) {
      dm[r.metric_key] = { value: r.value_num, rank: rk };
    }
    const sc = (sourcesByDay[d] ||= {});
    sc[r.source] = (sc[r.source] || 0) + 1;
  }

  const dayWear = {};
  for (const [d, metrics] of Object.entries(bestByDay)) {
    const row = (dayWear[d] ||= {});
    for (const [field, cfg] of Object.entries(WEARABLE_MAP)) {
      let v = metrics[cfg.key]?.value;
      if (field === "sleep_rhr_bpm" && v == null) {
        v = metrics["sleep_hr_avg"]?.value; // fallback
      }
      if (v == null) continue;
      row[field] = cfg.div ? v / cfg.div : v;
    }
  }

  // ---- merge per day ----
  const dates = [...new Set([...Object.keys(dayScale), ...Object.keys(dayWear)])].sort();
  if (!dates.length) return null;
  const historyRows = dates.map((d) => ({
    date: d,
    reading_date: d,
    ...(dayScale[d] || {}),
    ...(dayWear[d] || {}),
  }));

  // `today` is a current snapshot, not just the latest calendar day: fill each
  // field with its most recent non-null value (the latest scan's composition +
  // the latest wearable readings), anchored to the latest reading date. Without
  // this, a wearable-only latest day would leave the scale pillars with no
  // "today" value and collapse the weight/movement scores.
  const latestDate = historyRows[historyRows.length - 1].date;
  const today = { date: latestDate, reading_date: latestDate };
  const FIELD_NAMES = [...Object.keys(SCALE_MAP), ...Object.keys(WEARABLE_MAP)];
  for (let i = historyRows.length - 1; i >= 0; i--) {
    for (const f of FIELD_NAMES) {
      if (today[f] == null && historyRows[i][f] != null) today[f] = historyRows[i][f];
    }
  }
  for (let i = historyRows.length - 1; i >= 0; i--) {
    const src = sourcesByDay[historyRows[i].date];
    if (src) {
      today.wearable_source = Object.entries(src).sort((a, b) => b[1] - a[1])[0][0];
      break;
    }
  }

  return { today, historyRows, profile };
}

module.exports = { getScanCount, buildScoringInputs, MIN_SCANS };
