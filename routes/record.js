const express = require("express");
const router = express.Router();
const { processRecordData } = require("../utils/recordProcessor");
const {
  saveRecordToSupabase,
  updateGoalSummaries,
} = require("../services/supabase");
const { generateSummariesForRecord } = require("../utils/summaryGenerator");

/**
 * Handle record endpoint
 * Processes incoming measurement data, fetches body data from Lefu API if needed,
 * and saves to Supabase
 */
async function handleRecord(req, res) {
  console.log("📊 Torre Device Measurement Record");

  // Process the record data
  if (req.body) {
    // First, try to fetch body data from Lefu API if impedance data is available
    const processResult = await processRecordData(req.body);

    if (processResult.success && processResult.bodyData) {
      // We got body data from Lefu API, save it
      console.log("💾 Saving record with Lefu API body data to Supabase...");

      // Extract user ID from request (could be in list[0].userid or req.body.userid)
      const userId =
        (req.body.list && req.body.list[0] && req.body.list[0].userid) ||
        req.body.userid ||
        null;

      const recordData = {
        code: 200,
        msg: "success",
        data: {
          version: req.body.version || null,
          errorType: req.body.errorType || "PP_ERROR_TYPE_NONE",
          lefuBodyData: processResult.bodyData,
        },
        scaleUserId: userId,
      };
      const saveResult = await saveRecordToSupabase(
        recordData,
        processResult.bodyData
      );
      if (saveResult.success) {
        console.log("✅ Data saved successfully");

        // Generate and save AI summaries for goal cards
        if (saveResult.recordId && processResult.bodyData) {
          console.log("🤖 Generating AI summaries for goal cards...");
          try {
            const summaries = await generateSummariesForRecord(
              processResult.bodyData,
              userId,
              saveResult.recordId
            );
            await updateGoalSummaries(saveResult.recordId, summaries);
            console.log("✅ AI summaries generated and saved");
          } catch (summaryError) {
            console.error(
              "⚠️  Error generating summaries:",
              summaryError.message
            );
            // Don't fail the request if summaries fail
          }
        }
      } else {
        console.log(`⚠️  Failed to save data: ${saveResult.error}`);
      }
    } else if (req.body.code === 200) {
      // If request already has code 200 with body data, save it directly
      console.log("💾 Detected code 200 - saving to Supabase...");

      // Extract user ID from request if not already in recordData
      if (!req.body.scaleUserId) {
        const userId =
          (req.body.data?.list && req.body.data.list[0]?.userid) ||
          (req.body.list && req.body.list[0]?.userid) ||
          req.body.userid ||
          null;
        if (userId) {
          req.body.scaleUserId = userId;
        }
      }

      const saveResult = await saveRecordToSupabase(req.body);
      if (saveResult.success) {
        console.log("✅ Data saved successfully");

        // Generate and save AI summaries for goal cards
        const bodyData = req.body.data?.lefuBodyData || req.body.lefuBodyData;
        const userId = req.body.scaleUserId || null;
        if (saveResult.recordId && bodyData && Array.isArray(bodyData)) {
          console.log("🤖 Generating AI summaries for goal cards...");
          try {
            const summaries = await generateSummariesForRecord(
              bodyData,
              userId,
              saveResult.recordId
            );
            await updateGoalSummaries(saveResult.recordId, summaries);
            console.log("✅ AI summaries generated and saved");
          } catch (summaryError) {
            console.error(
              "⚠️  Error generating summaries:",
              summaryError.message
            );
            // Don't fail the request if summaries fail
          }
        }
      } else {
        console.log(`⚠️  Failed to save data: ${saveResult.error}`);
      }
    } else if (processResult.error) {
      console.log(`⚠️  Could not process record: ${processResult.error}`);
    }
  }

  const response = {
    errorCode: 0,
    text: "Record uploaded successfully",
    data: {
      nowTime: Date.now(),
      recordId: Math.random().toString(36).substring(7),
    },
  };

  console.log("\n📤 Response:");
  console.log(JSON.stringify(response, null, 2));
  console.log("=".repeat(80) + "\n");

  res.set({
    "Content-Type": "application/json",
    Connection: "close",
  });

  res.status(200).json(response);
}

// Vendor pattern routes (with /devices/claim prefix)
router.post("/devices/claim/lefu/wifi/torre/record", handleRecord);

// Root path routes (for testing)
router.post("/lefu/wifi/torre/record", handleRecord);

module.exports = router;
