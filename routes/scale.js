const express = require("express");
const router = express.Router();
const { getServiceClient } = require("../services/supabase");
const { success, error } = require("../utils/apiResponse");

const SCALE_DATA_LIMITS = {
  MAX_MEASUREMENTS_PER_RECORD: 200,
  MAX_TREND_RECORDS: 30,
  BATCH_SIZE: 100,
};

// GET /api/scale/latest?userId=X - Get latest scale record with measurements
router.get("/scale/latest", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { userId } = req.query;
    if (!userId) return success(res, null);

    // Fetch latest scale record
    const { data: recordData, error: recordError } = await supabase
      .from("scale_records")
      .select(
        "id, created_at, updated_at, scale_user_id, code, msg, version, error_type, goal_summaries",
      )
      .eq("scale_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recordError || !recordData) {
      return success(res, null);
    }

    // Fetch measurements
    const { data: measurementsData, error: measurementsError } = await supabase
      .from("scale_measurements")
      .select(
        "body_param_key, body_param_name, unit, current_value_num, current_value_text, " +
          "standard_title, current_standard, stand_color, color_array, standard_array, " +
          "standard_title_array, introduction, stand_suggestion, stand_evaluation",
      )
      .eq("scale_record_id", recordData.id)
      .order("body_param_key", { ascending: true })
      .limit(SCALE_DATA_LIMITS.MAX_MEASUREMENTS_PER_RECORD);

    if (measurementsError) {
      return success(res, { ...recordData, lefu_body_data: [], measurements: [] });
    }

    // Filter out impedance measurements
    const isImpedanceMeasurement = (key) => {
      if (!key) return false;
      const lowerKey = key.toLowerCase();
      return (
        lowerKey.includes("z20") ||
        lowerKey.includes("z50") ||
        lowerKey.includes("z100") ||
        lowerKey.includes("impedance") ||
        /z\d+khz/i.test(key) ||
        /z\d+\s*khz/i.test(key)
      );
    };

    // Transform to lefu_body_data format for backward compatibility
    const lefuBodyData = (measurementsData || [])
      .filter((m) => !isImpedanceMeasurement(m.body_param_key))
      .map((m) => ({
        bodyParamKey: m.body_param_key,
        bodyParamName: m.body_param_name,
        unit: m.unit,
        currentValue: m.current_value_num !== null ? m.current_value_num : m.current_value_text,
        standardTitle: m.standard_title,
        currentStandard: m.current_standard,
        standColor: m.stand_color,
        colorArray: m.color_array,
        standardArray: m.standard_array,
        standardTitleArray: m.standard_title_array,
        introduction: m.introduction,
        standSuggestion: m.stand_suggestion,
        standeEvaluation: m.stand_evaluation,
      }));

    return success(res, {
      ...recordData,
      lefu_body_data: lefuBodyData,
      measurements: measurementsData || [],
    });
  } catch (err) {
    console.error("❌ GET /api/scale/latest error:", err.message);
    return error(res, "Failed to fetch latest scale record");
  }
});

// GET /api/scale/export?userId=X&range=7d|1m|6m|1y|all - Get records with measurements for export
router.get("/scale/export", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { userId, range } = req.query;
    if (!userId) return success(res, []);

    // Calculate date filter based on range
    let query = supabase
      .from("scale_records")
      .select("id, created_at, scale_user_id")
      .eq("scale_user_id", userId)
      .order("created_at", { ascending: false });

    if (range && range !== "all") {
      const now = new Date();
      let sinceDate;
      switch (range) {
        case "1d":
          sinceDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
          break;
        case "7d":
          sinceDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "1m":
          sinceDate = new Date(now);
          sinceDate.setMonth(sinceDate.getMonth() - 1);
          break;
        case "6m":
          sinceDate = new Date(now);
          sinceDate.setMonth(sinceDate.getMonth() - 6);
          break;
        case "1y":
          sinceDate = new Date(now);
          sinceDate.setFullYear(sinceDate.getFullYear() - 1);
          break;
        default:
          sinceDate = null;
      }
      if (sinceDate) {
        query = query.gte("created_at", sinceDate.toISOString());
      }
    }

    const { data: records, error: recordsError } = await query;

    if (recordsError || !records || records.length === 0) {
      return success(res, []);
    }

    // Filter impedance
    const isImpedanceMeasurement = (key) => {
      if (!key) return false;
      const lowerKey = key.toLowerCase();
      return (
        lowerKey.includes("z20") ||
        lowerKey.includes("z50") ||
        lowerKey.includes("z100") ||
        lowerKey.includes("impedance") ||
        /z\d+khz/i.test(key) ||
        /z\d+\s*khz/i.test(key)
      );
    };

    // Fetch measurements for all records in batches
    const recordIds = records.map((r) => r.id);
    let allMeasurements = [];
    for (let i = 0; i < recordIds.length; i += SCALE_DATA_LIMITS.BATCH_SIZE) {
      const batchIds = recordIds.slice(i, i + SCALE_DATA_LIMITS.BATCH_SIZE);
      const { data: batchMeasurements } = await supabase
        .from("scale_measurements")
        .select("scale_record_id, body_param_key, body_param_name, unit, current_value_num, current_value_text")
        .in("scale_record_id", batchIds);

      if (batchMeasurements) {
        allMeasurements.push(...batchMeasurements);
      }
    }

    // Group measurements by record ID
    const measurementsByRecord = new Map();
    for (const m of allMeasurements) {
      if (isImpedanceMeasurement(m.body_param_key)) continue;
      if (!measurementsByRecord.has(m.scale_record_id)) {
        measurementsByRecord.set(m.scale_record_id, []);
      }
      measurementsByRecord.get(m.scale_record_id).push({
        bodyParamKey: m.body_param_key,
        bodyParamName: m.body_param_name,
        unit: m.unit,
        currentValue: m.current_value_num !== null ? m.current_value_num : m.current_value_text,
      });
    }

    // Build result: records with their measurements
    const result = records.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      measurements: measurementsByRecord.get(r.id) || [],
    }));

    return success(res, result);
  } catch (err) {
    console.error("❌ GET /api/scale/export error:", err.message);
    return error(res, "Failed to fetch export data");
  }
});

// GET /api/scale/records?userId=X&limit=N - Get scale record history
router.get("/scale/records", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { userId, limit } = req.query;
    if (!userId) return success(res, []);

    const { data, error: dbError } = await supabase
      .from("scale_records")
      .select("id, created_at, scale_user_id")
      .eq("scale_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(parseInt(limit) || 10);

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, data || []);
  } catch (err) {
    console.error("❌ GET /api/scale/records error:", err.message);
    return error(res, "Failed to fetch scale records");
  }
});

// GET /api/scale/previous?userId=X&beforeDate=D - Get previous scale record
router.get("/scale/previous", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { userId, beforeDate } = req.query;
    if (!userId || !beforeDate) return success(res, null);

    const { data, error: dbError } = await supabase
      .from("scale_records")
      .select("id, created_at")
      .eq("scale_user_id", userId)
      .lt("created_at", beforeDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, data || null);
  } catch (err) {
    console.error("❌ GET /api/scale/previous error:", err.message);
    return error(res, "Failed to fetch previous record");
  }
});

// GET /api/scale/measurement?recordId=N&bodyParamKey=K - Get single measurement value
router.get("/scale/measurement", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { recordId, bodyParamKey } = req.query;
    if (!recordId || !bodyParamKey) return success(res, null);

    const { data, error: dbError } = await supabase
      .from("scale_measurements")
      .select("current_value_num")
      .eq("scale_record_id", recordId)
      .eq("body_param_key", bodyParamKey)
      .maybeSingle();

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, data?.current_value_num ?? null);
  } catch (err) {
    console.error("❌ GET /api/scale/measurement error:", err.message);
    return error(res, "Failed to fetch measurement");
  }
});

// GET /api/scale/trend?userId=X&bodyParamKey=K&limit=N - Get metric trend data
router.get("/scale/trend", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { userId, bodyParamKey, limit } = req.query;
    if (!userId || !bodyParamKey) return success(res, null);

    const maxRecords = parseInt(limit) || SCALE_DATA_LIMITS.MAX_TREND_RECORDS;

    // Fetch recent scale records
    const { data: scaleRecords, error: recordsError } = await supabase
      .from("scale_records")
      .select("id, created_at")
      .eq("scale_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(maxRecords);

    if (recordsError || !scaleRecords || scaleRecords.length === 0) {
      return success(res, null);
    }

    // Reverse to chronological order
    const sortedRecords = [...scaleRecords].reverse();
    const recordIds = sortedRecords.map((r) => r.id);

    // Batch fetch measurements
    let allMeasurements = [];
    for (let i = 0; i < recordIds.length; i += SCALE_DATA_LIMITS.BATCH_SIZE) {
      const batchIds = recordIds.slice(i, i + SCALE_DATA_LIMITS.BATCH_SIZE);
      const { data: batchMeasurements, error: measurementsError } =
        await supabase
          .from("scale_measurements")
          .select("scale_record_id, current_value_num")
          .in("scale_record_id", batchIds)
          .eq("body_param_key", bodyParamKey);

      if (!measurementsError && batchMeasurements) {
        allMeasurements.push(...batchMeasurements);
      }
    }

    // Map measurements to records
    const recordMap = new Map(sortedRecords.map((r) => [r.id, r]));
    const trendData = [];

    for (const measurement of allMeasurements) {
      const record = recordMap.get(measurement.scale_record_id);
      if (
        record &&
        measurement.current_value_num !== null &&
        measurement.current_value_num !== undefined
      ) {
        const value = Number(measurement.current_value_num);
        if (!isNaN(value) && value > 0) {
          trendData.push({
            recordId: record.id,
            value,
            date: record.created_at,
          });
        }
      }
    }

    return success(res, trendData.length > 0 ? trendData : null);
  } catch (err) {
    console.error("❌ GET /api/scale/trend error:", err.message);
    return error(res, "Failed to fetch trend data");
  }
});

// GET /api/scale/rai?userId=X&bodyParamKey=K - Get RAI analysis
router.get("/scale/rai", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { userId, bodyParamKey } = req.query;
    if (!userId || !bodyParamKey) return success(res, null);

    // Get latest scale record
    const { data: latestRecord } = await supabase
      .from("scale_records")
      .select("id")
      .eq("scale_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRecord) return success(res, null);

    // Get measurement id
    const { data: measurement } = await supabase
      .from("scale_measurements")
      .select("id, rai_insights, rai_tips")
      .eq("scale_record_id", latestRecord.id)
      .eq("body_param_key", bodyParamKey)
      .maybeSingle();

    if (!measurement) return success(res, null);

    return success(res, {
      rai_insights: measurement.rai_insights,
      rai_tips: measurement.rai_tips,
    });
  } catch (err) {
    console.error("❌ GET /api/scale/rai error:", err.message);
    return error(res, "Failed to fetch RAI analysis");
  }
});

// PUT /api/scale/rai - Update RAI analysis
router.put("/scale/rai", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { userId, bodyParamKey, raiInsights, raiTips } = req.body;
    if (!userId || !bodyParamKey || !raiInsights || !raiTips) {
      return error(res, "Missing required fields", 400);
    }

    // Get latest scale record
    const { data: latestRecord } = await supabase
      .from("scale_records")
      .select("id")
      .eq("scale_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRecord) return error(res, "No scale record found", 404);

    // Get measurement id
    const { data: measurement } = await supabase
      .from("scale_measurements")
      .select("id")
      .eq("scale_record_id", latestRecord.id)
      .eq("body_param_key", bodyParamKey)
      .maybeSingle();

    if (!measurement) return error(res, "Measurement not found", 404);

    const { error: dbError } = await supabase
      .from("scale_measurements")
      .update({ rai_insights: raiInsights, rai_tips: raiTips })
      .eq("id", measurement.id);

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, null, "RAI analysis updated");
  } catch (err) {
    console.error("❌ PUT /api/scale/rai error:", err.message);
    return error(res, "Failed to update RAI analysis");
  }
});

// PUT /api/scale/goal-summaries - Update goal summaries on latest record
router.put("/scale/goal-summaries", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { userId, goalSummaries } = req.body;
    if (!userId || !goalSummaries) {
      return error(res, "Missing required fields", 400);
    }

    const { data: latestRecord } = await supabase
      .from("scale_records")
      .select("id")
      .eq("scale_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRecord) return error(res, "No scale record found", 404);

    const { error: dbError } = await supabase
      .from("scale_records")
      .update({ goal_summaries: goalSummaries })
      .eq("id", latestRecord.id);

    if (dbError) {
      return error(res, dbError.message, 500);
    }

    return success(res, null, "Goal summaries updated");
  } catch (err) {
    console.error("❌ PUT /api/scale/goal-summaries error:", err.message);
    return error(res, "Failed to update goal summaries");
  }
});

// PUT /api/scale/dexa-recalibrate - Apply DEXA Body Fat % with full cascade mutation
// Body: { userId, dexaBodyFatPct: 18.5, applyToFuture: boolean }
// Uses the same cascade logic as biyoCorrection.js applyCorrection
router.put("/scale/dexa-recalibrate", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { userId, dexaBodyFatPct, applyToFuture } = req.body;

    if (!userId || dexaBodyFatPct == null || isNaN(Number(dexaBodyFatPct))) {
      return error(res, "userId and dexaBodyFatPct are required", 400);
    }

    const bfNew = Number(dexaBodyFatPct);
    if (bfNew < 1 || bfNew > 70) {
      return error(res, "dexaBodyFatPct must be between 1 and 70", 400);
    }

    // 1. Fetch latest scale record with body data
    const { data: record, error: fetchErr } = await supabase
      .from("scale_records")
      .select("id, mutated_response, lefu_body_data")
      .eq("scale_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchErr || !record) {
      return error(res, "No scale record found for this user", 404);
    }

    const bodyData = record.mutated_response ?? record.lefu_body_data;
    if (!Array.isArray(bodyData) || bodyData.length === 0) {
      return error(res, "No body data in latest record", 400);
    }

    // 2. Extract current metrics using biyoCorrection helpers
    const {
      getParamKey,
      getCurrentValue,
      setCurrentValue,
      getItemRole,
      extractMetrics,
    } = require("../utils/biyoCorrection");

    const metrics = extractMetrics(bodyData, null, null);
    const weight = metrics.weight;
    const ffmOld = metrics.ffm;

    if (weight == null || weight <= 0) {
      return error(res, "Cannot recalibrate: no weight found in record", 400);
    }
    if (ffmOld == null || ffmOld <= 0) {
      return error(res, "Cannot recalibrate: no FFM found in record", 400);
    }

    // 3. Cascade: same logic as biyoCorrection.applyCorrection
    const fatMassNew = weight * (bfNew / 100);
    const ffmNew = weight - fatMassNew;
    const k = ffmNew / ffmOld; // scaling factor for all FFM components

    // Deep copy body data
    const mutatedBodyData = bodyData.map((item) => ({ ...item }));
    const changedKeys = {};

    for (const item of mutatedBodyData) {
      const key = getParamKey(item);
      const role = getItemRole(key);
      const val = getCurrentValue(item);
      if (val === null) continue;

      switch (role) {
        case "weight":
          // unchanged
          break;
        case "bodyFatPct":
          setCurrentValue(item, bfNew);
          changedKeys[key] = bfNew;
          break;
        case "fatMass":
          setCurrentValue(item, fatMassNew);
          changedKeys[key] = fatMassNew;
          break;
        case "ffm":
          setCurrentValue(item, ffmNew);
          changedKeys[key] = ffmNew;
          break;
        case "visceral":
          // leave as-is (level, not a mass)
          break;
        case "muscleMass":
        case "ffmComponent": {
          const newVal = val * k;
          setCurrentValue(item, newVal);
          changedKeys[key] = newVal;
          break;
        }
        default:
          break;
      }
    }

    // 4. Recalculate percentage metrics from new mass values
    const mutatedValues = {};
    for (const item of mutatedBodyData) {
      const key = getParamKey(item);
      const val = getCurrentValue(item);
      if (val !== null) mutatedValues[key] = val;
    }

    const newWeight = mutatedValues["ppWeightKg"] ?? weight;
    const percentageRecalculations = {
      ppMusclePercentage: mutatedValues["ppMuscleKg"] != null
        ? (mutatedValues["ppMuscleKg"] / newWeight) * 100 : null,
      ppProteinPercentage: mutatedValues["ppProteinKg"] != null
        ? (mutatedValues["ppProteinKg"] / newWeight) * 100 : null,
      ppWaterPercentage: mutatedValues["ppWaterKg"] != null
        ? (mutatedValues["ppWaterKg"] / newWeight) * 100 : null,
      ppBodySkeletal: mutatedValues["ppBodySkeletalKg"] != null
        ? (mutatedValues["ppBodySkeletalKg"] / newWeight) * 100 : null,
    };

    for (const item of mutatedBodyData) {
      const key = getParamKey(item);
      if (percentageRecalculations[key] != null) {
        setCurrentValue(item, percentageRecalculations[key]);
        changedKeys[key] = percentageRecalculations[key];
      }
    }

    // 5. Clamp health score to 0-100
    for (const item of mutatedBodyData) {
      const key = getParamKey(item);
      if (key === "ppBodyScore") {
        const val = getCurrentValue(item);
        if (val !== null && val > 100) {
          setCurrentValue(item, 100);
          changedKeys[key] = 100;
        }
      }
    }

    // 6. Update scale_records.mutated_response
    const { error: updateErr } = await supabase
      .from("scale_records")
      .update({
        mutated_response: mutatedBodyData,
        is_recalibrated: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id);

    if (updateErr) {
      console.error("❌ Failed to update scale_records:", updateErr.message);
      return error(res, "Failed to update scale record");
    }

    // 7. Batch update all changed scale_measurements rows
    for (const [paramKey, newValue] of Object.entries(changedKeys)) {
      const rounded = Math.round(Number(newValue) * 100) / 100;
      const { error: measErr } = await supabase
        .from("scale_measurements")
        .update({ current_value_num: rounded })
        .eq("scale_record_id", record.id)
        .eq("body_param_key", paramKey);

      if (measErr) {
        console.error(`⚠️  Failed to update measurement ${paramKey}:`, measErr.message);
      }
    }

    const metricsUpdated = Object.keys(changedKeys).length;
    console.log(
      `✅ DEXA recalibration applied to record #${record.id} for user ${userId}:`,
      `BF% ${bfNew}, k=${k.toFixed(4)}, ${metricsUpdated} metrics updated`
    );

    // 8. Save or clear dexa_bf_offset on users table
    const originalBfPct = metrics.bfPct;
    let offsetSaved = false;
    if (applyToFuture === true && originalBfPct != null) {
      const offset = bfNew - originalBfPct;
      const { error: offsetErr } = await supabase
        .from("users")
        .update({ dexa_bf_offset: offset })
        .eq("id", userId);
      if (offsetErr) {
        console.error("⚠️  Failed to save dexa_bf_offset:", offsetErr.message);
      } else {
        offsetSaved = true;
        console.log(`   dexa_bf_offset saved: ${offset.toFixed(2)} pp`);
      }
    } else {
      // Clear any previous offset
      const { error: clearErr } = await supabase
        .from("users")
        .update({ dexa_bf_offset: null })
        .eq("id", userId);
      if (clearErr) {
        console.error("⚠️  Failed to clear dexa_bf_offset:", clearErr.message);
      }
    }

    return success(res, { recordId: record.id, metricsUpdated, offsetSaved }, "DEXA recalibration applied");
  } catch (err) {
    console.error("❌ PUT /api/scale/dexa-recalibrate error:", err.message);
    return error(res, "Failed to apply DEXA recalibration");
  }
});

module.exports = router;
