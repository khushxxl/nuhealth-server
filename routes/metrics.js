const express = require("express");
const router = express.Router();
const { getServiceClient } = require("../services/supabase");
const { success, error } = require("../utils/apiResponse");

const MAX_TREND_RECORDS = 30;
const BATCH_SIZE = 100;

// Metric type to body param key mapping (mirrors frontend METRIC_KEY_MAP)
const METRIC_KEY_MAP = {
  weight: "ppWeightKg",
  fat: "ppBodyFatRate",
  muscleMass: "ppMuscleKg",
  healthScore: "ppBodyScore",
  bodyAge: "ppBodyAge",
  bmr: "ppBMR",
  bmi: "ppBMI",
  waistHipRatio: "ppWaistHipRate",
  standardWeight: "ppIdealWeightKg",
  idealWeight: "ppIdealWeightKg",
  obesityLevel: "ppObesityLevel",
  obesityDegree: "ppObesityDegree",
  bodyFat: "ppBodyFatRate",
  fatMass: "ppFatKg",
  visceralFat: "ppVisceralFatIndex",
  subcutaneousFat: "ppSubcutaneousFatRate",
  subcutaneousFatKg: "ppSubcutaneousFatKg",
  fatFreeMass: "ppBodyFatFreeMassKg",
  skeletalMuscle: "ppSkeletalMuscleRatePercent",
  muscleRate: "ppMuscleRate",
  skeletalMuscleRatio: "ppSkeletalMuscleRatePercent",
  skeletalMuscleIndex: "ppSkeletalMuscleIndex",
  boneMass: "ppBoneMassKg",
  minerals: "ppMineralKg",
  totalBodyWater: "ppWaterKg",
  waterPercentage: "ppWaterRate",
  intracellularWater: "ppIntracellularWaterKg",
  extracellularWater: "ppExtracellularWaterKg",
  proteinMass: "ppProteinKg",
  proteinRate: "ppProteinRate",
  bodyCellMass: "ppBodyCellMassKg",
  recommendedCalories: "ppRecommendedCalories",
};

// GET /api/metrics/trend?userId=X&metricType=T - Get metric trend raw data points
router.get("/metrics/trend", async (req, res) => {
  try {
    const supabase = getServiceClient();
    const { userId, metricType } = req.query;
    if (!userId || !metricType) return success(res, null);

    const bodyParamKey = METRIC_KEY_MAP[metricType];
    if (!bodyParamKey) {
      return error(res, `Unknown metric type: ${metricType}`, 400);
    }

    // Fetch recent scale records
    const { data: scaleRecords, error: recordsError } = await supabase
      .from("scale_records")
      .select("id, created_at")
      .eq("scale_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_TREND_RECORDS);

    if (recordsError || !scaleRecords || scaleRecords.length === 0) {
      return success(res, null);
    }

    const sortedRecords = [...scaleRecords].reverse();
    const recordIds = sortedRecords.map((r) => r.id);

    // Batch fetch measurements
    let allMeasurements = [];
    for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
      const batchIds = recordIds.slice(i, i + BATCH_SIZE);
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

    // Map measurements to data points
    const recordMap = new Map(sortedRecords.map((r) => [r.id, r]));
    const dataPoints = [];

    for (const measurement of allMeasurements) {
      const record = recordMap.get(measurement.scale_record_id);
      if (
        record &&
        measurement.current_value_num !== null &&
        measurement.current_value_num !== undefined
      ) {
        const value = Number(measurement.current_value_num);
        if (!isNaN(value) && value > 0) {
          dataPoints.push({
            date: record.created_at,
            value,
          });
        }
      }
    }

    // Sort by date
    dataPoints.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return success(res, {
      dataPoints: dataPoints.length > 0 ? dataPoints : null,
      metricType,
      bodyParamKey,
    });
  } catch (err) {
    console.error("❌ GET /api/metrics/trend error:", err.message);
    return error(res, "Failed to fetch metric trend");
  }
});

module.exports = router;
