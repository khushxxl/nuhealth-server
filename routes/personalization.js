const express = require("express");
const router = express.Router();
const { getServiceClient } = require("../services/supabase");
const { success, error } = require("../utils/apiResponse");

/**
 * Helper to get user ID from auth email
 */
async function getUserId(supabase, email) {
  const { data, error: lookupError } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .single();

  if (lookupError || !data) return null;
  return data.id;
}

// GET /api/personalization?date=YYYY-MM-DD - Get personalization for a date
router.get("/personalization", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const userId = await getUserId(supabase, req.user.email);
    if (!userId) return success(res, null);

    const { date } = req.query;
    if (!date) {
      return error(res, "date query parameter is required", 400);
    }

    const dateObj = new Date(date);
    const startOfDay = new Date(dateObj);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateObj);
    endOfDay.setHours(23, 59, 59, 999);

    const { data, error: dbError } = await supabase
      .from("personalization")
      .select("*")
      .eq("userid", userId)
      .gte("created_at", startOfDay.toISOString())
      .lte("created_at", endOfDay.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    const checkinResult = data?.checkin_results?.[0] || null;
    return success(res, checkinResult);
  } catch (err) {
    console.error("❌ GET /api/personalization error:", err.message);
    return error(res, "Failed to fetch personalization");
  }
});

// GET /api/personalization/latest - Get the latest personalization record
router.get("/personalization/latest", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const userId = await getUserId(supabase, req.user.email);
    if (!userId) return success(res, null);

    const { data, error: dbError } = await supabase
      .from("personalization")
      .select("checkin_results")
      .eq("userid", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, data);
  } catch (err) {
    console.error("❌ GET /api/personalization/latest error:", err.message);
    return error(res, "Failed to fetch latest personalization");
  }
});

// POST /api/personalization - Create new personalization record
router.post("/personalization", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const userId = await getUserId(supabase, req.user.email);
    if (!userId) return error(res, "User not found", 404);

    const data = req.body;
    if (!data) {
      return error(res, "Request body is required", 400);
    }

    const { data: inserted, error: dbError } = await supabase
      .from("personalization")
      .insert(data)
      .select();

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, inserted, "Personalization created", 201);
  } catch (err) {
    console.error("❌ POST /api/personalization error:", err.message);
    return error(res, "Failed to create personalization");
  }
});

// PUT /api/personalization - Update personalization checkin_results
router.put("/personalization", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const userId = await getUserId(supabase, req.user.email);
    if (!userId) return error(res, "User not found", 404);

    const updateData = req.body;

    // Fetch current personalization
    const { data: currentData, error: fetchError } = await supabase
      .from("personalization")
      .select("*")
      .eq("userid", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (fetchError) {
      return error(res, fetchError.message, 500);
    }

    // Update checkin_results
    const updatedCheckinResults = currentData.checkin_results.map(
      (result, index) => {
        if (index === 0) {
          return { ...result, ...updateData };
        }
        return result;
      },
    );

    const { error: updateError } = await supabase
      .from("personalization")
      .update({ checkin_results: updatedCheckinResults })
      .eq("userid", userId)
      .eq("id", currentData.id);

    if (updateError) {
      return error(res, updateError.message, 500);
    }

    return success(res, null, "Personalization updated");
  } catch (err) {
    console.error("❌ PUT /api/personalization error:", err.message);
    return error(res, "Failed to update personalization");
  }
});

// GET /api/personalization/weekly?endDate=YYYY-MM-DD - Get weekly check-in data
router.get("/personalization/weekly", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const userId = await getUserId(supabase, req.user.email);
    if (!userId) return success(res, null);

    const { endDate } = req.query;
    if (!endDate) {
      return error(res, "endDate query parameter is required", 400);
    }

    const endDateObj = new Date(endDate);
    const startDate = new Date(endDateObj);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);
    const endDateWithTime = new Date(endDateObj);
    endDateWithTime.setHours(23, 59, 59, 999);

    const { data, error: dbError } = await supabase
      .from("personalization")
      .select("checkin_results, created_at")
      .eq("userid", userId)
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDateWithTime.toISOString())
      .order("created_at", { ascending: true });

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    // Process data
    const processedData = {
      sleep: { quality: [], wakeup: [], soreness: [] },
      physical: { energy: [], activity: [], recovery: [] },
      mental: { focus: [], stress: [], mood: [] },
      dates: [],
    };

    const normalizeDate = (date) => {
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    };

    // Create a map of dates to check-in results
    const dateMap = new Map();
    (data || []).forEach((item) => {
      if (item.checkin_results?.[0]) {
        const itemDate = new Date(item.created_at);
        const dateStr = normalizeDate(itemDate);
        dateMap.set(dateStr, item.checkin_results[0]);
      }
    });

    // Fill in data for last 7 days
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(endDateObj);
      date.setDate(date.getDate() - i);
      const dateStr = normalizeDate(date);
      const checkin = dateMap.get(dateStr);

      const dayName = dayNames[date.getUTCDay()];
      processedData.dates.push(dayName);

      if (checkin) {
        processedData.sleep.quality.push(checkin.sleep_metrics?.sleep_quality ?? 0);
        processedData.sleep.wakeup.push(checkin.sleep_metrics?.wake_feeling ?? 0);
        processedData.sleep.soreness.push(checkin.recovery_metrics?.soreness_level ?? 0);
        processedData.physical.energy.push(checkin.performance_metrics?.energy_level ?? 0);
        processedData.physical.activity.push(checkin.mental_state_metrics?.physical_activity ?? 0);
        processedData.physical.recovery.push(checkin.recovery_metrics?.recovery_rate ?? 0);
        processedData.mental.focus.push(checkin.performance_metrics?.focus_rating ?? 0);
        processedData.mental.stress.push(checkin.performance_metrics?.stress_level ?? 0);
        processedData.mental.mood.push(checkin.mental_state_metrics?.mood_level ?? 0);
      } else {
        processedData.sleep.quality.push(0);
        processedData.sleep.wakeup.push(0);
        processedData.sleep.soreness.push(0);
        processedData.physical.energy.push(0);
        processedData.physical.activity.push(0);
        processedData.physical.recovery.push(0);
        processedData.mental.focus.push(0);
        processedData.mental.stress.push(0);
        processedData.mental.mood.push(0);
      }
    }

    return success(res, processedData);
  } catch (err) {
    console.error("❌ GET /api/personalization/weekly error:", err.message);
    return error(res, "Failed to fetch weekly data");
  }
});

// GET /api/personalization/streaks - Calculate streak data
router.get("/personalization/streaks", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const userId = await getUserId(supabase, req.user.email);
    if (!userId) {
      return success(res, { currentStreak: 0, maxStreak: 0, totalPossibleDays: 0 });
    }

    const { data, error: dbError } = await supabase
      .from("personalization")
      .select("created_at")
      .eq("userid", userId)
      .order("created_at", { ascending: true });

    if (dbError || !data || data.length === 0) {
      return success(res, { currentStreak: 0, maxStreak: 0, totalPossibleDays: 0 });
    }

    // Get unique dates
    const uniqueDates = [
      ...new Set(
        data.map((entry) => {
          const date = new Date(entry.created_at);
          return date.toISOString().split("T")[0];
        }),
      ),
    ].sort();

    if (uniqueDates.length === 0) {
      return success(res, { currentStreak: 0, maxStreak: 0, totalPossibleDays: 0 });
    }

    let maxStreak = 1;
    let tempStreak = 1;

    const today = new Date();
    const todayString = today.toISOString().split("T")[0];
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayString = yesterday.toISOString().split("T")[0];

    const firstCheckIn = new Date(uniqueDates[0]);
    const totalPossibleDays =
      Math.ceil((today.getTime() - firstCheckIn.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    for (let i = 1; i < uniqueDates.length; i++) {
      const currentDate = new Date(uniqueDates[i]);
      const previousDate = new Date(uniqueDates[i - 1]);
      const diffInDays = Math.round(
        (currentDate.getTime() - previousDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (diffInDays === 1) {
        tempStreak++;
        maxStreak = Math.max(maxStreak, tempStreak);
      } else {
        tempStreak = 1;
      }
    }

    let currentStreak;
    const lastCheckInDate = uniqueDates[uniqueDates.length - 1];
    if (lastCheckInDate === todayString || lastCheckInDate === yesterdayString) {
      currentStreak = tempStreak;
    } else {
      currentStreak = 0;
    }

    return success(res, { currentStreak, maxStreak, totalPossibleDays });
  } catch (err) {
    console.error("❌ GET /api/personalization/streaks error:", err.message);
    return error(res, "Failed to calculate streaks");
  }
});

module.exports = router;
