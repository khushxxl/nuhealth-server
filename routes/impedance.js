const express = require("express");
const router = express.Router();
const { processRecordData } = require("../utils/recordProcessor");
const {
  saveRecordToSupabase,
  updateGoalSummaries,
} = require("../services/supabase");
const { generateSummariesForRecord } = require("../utils/summaryGenerator");
const { getUserProfile } = require("../services/supabase");
const { sendPushNotification } = require("../services/notification");

/**
 * POST /api/impedance
 *
 * Manual impedance submission endpoint.
 * Accepts named encrypted u32 impedance values (5 segments x 2 frequencies),
 * runs them through the same pipeline as scale records:
 *   Lefu API -> BIYO correction -> Supabase save -> AI summaries
 */

const IMPEDANCE_KEYS = [
  "rightHand_20KHz",
  "rightHand_100KHz",
  "leftHand_20KHz",
  "leftHand_100KHz",
  "trunk_20KHz",
  "trunk_100KHz",
  "rightFoot_20KHz",
  "rightFoot_100KHz",
  "leftFoot_20KHz",
  "leftFoot_100KHz",
];

async function handleImpedance(req, res) {
  console.log("📡 Manual Impedance Submission");

  const { userid, age, height, weight, sex, product, impedance } = req.body;

  // Validate impedance object
  if (!impedance || typeof impedance !== "object") {
    return res.status(400).json({
      errorCode: 1,
      text: "Missing 'impedance' object in request body",
      data: null,
    });
  }

  // Validate all 10 impedance keys are present
  const missing = IMPEDANCE_KEYS.filter(
    (key) => impedance[key] === undefined || impedance[key] === null,
  );
  if (missing.length > 0) {
    return res.status(400).json({
      errorCode: 1,
      text: `Missing impedance values: ${missing.join(", ")}`,
      data: null,
    });
  }

  // Map named impedance values to the array format the pipeline expects
  const impedanceArray = IMPEDANCE_KEYS.map((key) => Number(impedance[key]));

  // Build a request body in the format processRecordData understands
  const syntheticBody = {
    impedanceArray,
    userid: userid || null,
    age,
    height,
    weight,
    sex,
    product: product || 5,
  };

  // Run through the same pipeline as the scale record endpoint
  const processResult = await processRecordData(syntheticBody);

  if (!processResult.success || !processResult.bodyData) {
    console.log(
      `⚠️  Could not process impedance: ${processResult.error || "Unknown error"}`,
    );
    return res.status(422).json({
      errorCode: 1,
      text: processResult.error || "Failed to process impedance data",
      data: null,
    });
  }

  console.log("💾 Saving manual impedance record to Supabase...");

  const recordData = {
    code: 200,
    msg: "success",
    data: {
      version: null,
      errorType: "PP_ERROR_TYPE_NONE",
      lefuBodyData: processResult.bodyData,
    },
    scaleUserId: userid || null,
  };

  const saveResult = await saveRecordToSupabase(
    recordData,
    processResult.bodyData,
    processResult.mutatedBodyData,
  );

  if (!saveResult.success) {
    console.log(`⚠️  Failed to save data: ${saveResult.error}`);
    return res.status(500).json({
      errorCode: 1,
      text: `Failed to save record: ${saveResult.error}`,
      data: null,
    });
  }

  console.log("✅ Data saved successfully");

  // Send push notification to user
  if (userid) {
    const profileResult = await getUserProfile(userid);
    if (profileResult.success && profileResult.profile?.notification_id) {
      sendPushNotification(
        profileResult.profile.notification_id,
        "New Measurement",
        "Your body composition data has been updated, check body page!",
      ).catch((err) =>
        console.error("⚠️  Error sending notification:", err.message),
      );
    }
  }

  // Generate AI summaries in the background (don't block response)
  if (saveResult.recordId && processResult.mutatedBodyData) {
    console.log("🤖 Generating AI summaries for goal cards...");
    generateSummariesForRecord(
      processResult.mutatedBodyData,
      userid || null,
      saveResult.recordId,
    )
      .then((summaries) => updateGoalSummaries(saveResult.recordId, summaries))
      .then(() => console.log("✅ AI summaries generated and saved"))
      .catch((err) =>
        console.error("⚠️  Error generating summaries:", err.message),
      );
  }

  res.status(200).json({
    errorCode: 0,
    text: "Impedance processed successfully",
    data: {
      recordId: saveResult.recordId,
      bodyData: processResult.mutatedBodyData,
    },
  });
}

router.post("/api/impedance", handleImpedance);

module.exports = router;
