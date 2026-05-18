const express = require("express");
const router = express.Router();
const { getServiceClient } = require("../services/supabase");
const { success, error } = require("../utils/apiResponse");

// Each Biyo supplement bottle ships with this many doses (one per day).
const PACKAGE_SIZE = 30;
// When the user has this many doses (or fewer) left in their bottle, surface
// a reorder banner in the app so they don't run out before a new one arrives.
const REORDER_THRESHOLD = 7;
const REORDER_URL = "https://biyo.com/pages/longevity";

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function dateNDaysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

/**
 * Compute the current streak (days in a row up to today, or up to the most
 * recent logged day if today isn't logged yet) from a sorted list of
 * taken_date strings (descending).
 */
function computeStreak(takenDatesDesc) {
  if (!takenDatesDesc.length) return 0;
  const set = new Set(takenDatesDesc);
  let streak = 0;
  const cursor = new Date();
  // If today isn't logged yet, anchor on yesterday so an unlogged today
  // doesn't reset the streak mid-day.
  const todayStr = todayISO();
  if (!set.has(todayStr)) cursor.setDate(cursor.getDate() - 1);
  while (true) {
    const key = cursor.toISOString().split("T")[0];
    if (!set.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * GET /api/biyo-supplements/status
 * Returns whether the user has started tracking + streak / week summary so
 * the home screen can decide between the "Start Tracking" CTA and the
 * weekly streak panel without a second roundtrip.
 */
router.get("/biyo-supplements/status", async (req, res) => {
  try {
    const userId = req.user.id;
    const supabase = getServiceClient();
    if (!supabase) return error(res, "Database not configured", 500);

    const { data: tracking } = await supabase
      .from("biyo_supplements_tracking")
      .select("active, started_at, current_package_started_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (!tracking || !tracking.active) {
      return success(res, { tracking: false });
    }

    // Far enough back to cover the 90d graph + the entire current calendar
    // month for the consistency grid.
    const since = dateNDaysAgoISO(100);
    const { data: rows } = await supabase
      .from("biyo_supplements_log")
      .select("taken_date")
      .eq("user_id", userId)
      .gte("taken_date", since)
      .order("taken_date", { ascending: false });

    const takenDates = (rows || []).map((r) => r.taken_date);
    const streakDays = computeStreak(takenDates);

    // ── Package tracking ─────────────────────────────────────────────────
    // A package = 30 doses. Count how many doses the user has logged since
    // the current package was opened. If they pass the threshold, the
    // client will show a reorder banner; if they hit zero, it switches to a
    // "start your next package" CTA that pings POST /new-package below.
    const packageStartIso =
      tracking.current_package_started_at || tracking.started_at;
    const packageStartDate = packageStartIso
      ? packageStartIso.split("T")[0]
      : null;
    let dosesTakenInPackage = 0;
    if (packageStartDate) {
      dosesTakenInPackage = takenDates.filter(
        (d) => d >= packageStartDate,
      ).length;
    }
    const dosesRemaining = Math.max(0, PACKAGE_SIZE - dosesTakenInPackage);
    const needsReorder = dosesRemaining <= REORDER_THRESHOLD;
    const packageEmpty = dosesRemaining === 0;

    // Build the current ISO-week (Mon..Sun) view for the streak panel.
    const today = new Date();
    const dow = (today.getDay() + 6) % 7; // Mon=0..Sun=6
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - dow + i);
      const key = d.toISOString().split("T")[0];
      weekDays.push({
        label: ["M", "T", "W", "T", "F", "S", "S"][i],
        date: key,
        taken: takenDates.includes(key),
      });
    }

    const totalTaken = takenDates.length;

    return success(res, {
      tracking: true,
      startedAt: tracking.started_at,
      streakDays,
      totalTaken,
      weekDays,
      takenDates,
      package: {
        size: PACKAGE_SIZE,
        startedAt: packageStartIso,
        dosesTaken: dosesTakenInPackage,
        dosesRemaining,
        reorderThreshold: REORDER_THRESHOLD,
        needsReorder,
        empty: packageEmpty,
        reorderUrl: REORDER_URL,
      },
    });
  } catch (err) {
    console.error("[BiyoSupplements] status error:", err.message);
    return error(res, "Failed to load supplements status", 500);
  }
});

/**
 * POST /api/biyo-supplements/start
 * Idempotently flips the user into tracking mode.
 */
router.post("/biyo-supplements/start", async (req, res) => {
  try {
    const userId = req.user.id;
    const supabase = getServiceClient();
    if (!supabase) return error(res, "Database not configured", 500);

    const nowIso = new Date().toISOString();
    const { error: upsertErr } = await supabase
      .from("biyo_supplements_tracking")
      .upsert(
        {
          user_id: userId,
          active: true,
          started_at: nowIso,
          current_package_started_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "user_id" },
      );

    if (upsertErr) {
      console.error("[BiyoSupplements] start error:", upsertErr.message);
      return error(res, "Failed to start tracking", 500);
    }

    return success(res, { tracking: true });
  } catch (err) {
    console.error("[BiyoSupplements] start error:", err.message);
    return error(res, "Failed to start tracking", 500);
  }
});

/**
 * POST /api/biyo-supplements/log
 * Body: { date?: "YYYY-MM-DD" } — defaults to today.
 * Marks the supplement as taken for that day. Idempotent via UNIQUE constraint.
 */
router.post("/biyo-supplements/log", async (req, res) => {
  try {
    const userId = req.user.id;
    const date = (req.body && req.body.date) || todayISO();
    const supabase = getServiceClient();
    if (!supabase) return error(res, "Database not configured", 500);

    const { error: insertErr } = await supabase
      .from("biyo_supplements_log")
      .upsert(
        { user_id: userId, taken_date: date },
        { onConflict: "user_id,taken_date" },
      );

    if (insertErr) {
      console.error("[BiyoSupplements] log error:", insertErr.message);
      return error(res, "Failed to log intake", 500);
    }

    return success(res, { date });
  } catch (err) {
    console.error("[BiyoSupplements] log error:", err.message);
    return error(res, "Failed to log intake", 500);
  }
});

/**
 * DELETE /api/biyo-supplements/log
 * Body: { date?: "YYYY-MM-DD" } — defaults to today.
 */
router.delete("/biyo-supplements/log", async (req, res) => {
  try {
    const userId = req.user.id;
    const date = (req.body && req.body.date) || todayISO();
    const supabase = getServiceClient();
    if (!supabase) return error(res, "Database not configured", 500);

    await supabase
      .from("biyo_supplements_log")
      .delete()
      .eq("user_id", userId)
      .eq("taken_date", date);

    return success(res, { date });
  } catch (err) {
    console.error("[BiyoSupplements] unlog error:", err.message);
    return error(res, "Failed to remove intake", 500);
  }
});

/**
 * POST /api/biyo-supplements/new-package
 * Mark the start of a fresh 30-day package so the doses-remaining counter
 * resets to PACKAGE_SIZE. Called when the user confirms a new bottle has
 * arrived ("I've started a new package" in the app).
 */
router.post("/biyo-supplements/new-package", async (req, res) => {
  try {
    const userId = req.user.id;
    const supabase = getServiceClient();
    if (!supabase) return error(res, "Database not configured", 500);

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("biyo_supplements_tracking")
      .update({
        current_package_started_at: nowIso,
        updated_at: nowIso,
      })
      .eq("user_id", userId);

    if (updateErr) {
      console.error("[BiyoSupplements] new-package error:", updateErr.message);
      return error(res, "Failed to start new package", 500);
    }

    return success(res, { startedAt: nowIso });
  } catch (err) {
    console.error("[BiyoSupplements] new-package error:", err.message);
    return error(res, "Failed to start new package", 500);
  }
});

module.exports = router;
