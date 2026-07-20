/**
 * Digital Scan routes — camera/face-video wellness capture.
 *
 * POST /api/scan/rppg   multipart form-data, field "video" = face video
 *   -> forwards the clip to the rPPG microservice, returns heart rate / HRV /
 *      respiration, and stores the result in health_metrics (source
 *      "digital_scan") so it flows into the existing history + insights.
 *
 * Mounted BEFORE the global express.text() body parser in server.js, because
 * that parser would otherwise consume the multipart stream. Auth is applied at
 * the mount point (authMiddleware) so req.user is available.
 *
 * Wellness estimates only — not a medical device.
 */
const express = require("express");
const multer = require("multer");
const { success, error } = require("../utils/apiResponse");
const { getServiceClient } = require("../services/supabase");

const router = express.Router();

const RPPG_SERVICE_URL =
  process.env.RPPG_SERVICE_URL || "http://localhost:8800";

// Keep uploads bounded — a ~20s scan is a few MB; 60MB is generous headroom.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024 },
});

// Store the scan's vitals in health_metrics so the Digital / Wearables / All
// history toggle and the scoring pipeline can pick them up. Tagged with
// source "digital_scan" so they're distinguishable and rank below real
// wearables in the source-priority merge.
async function storeScan(userId, r) {
  const sb = getServiceClient();
  const recordedAt = new Date().toISOString();
  const rawPayload = { method: r.method, signal_quality: r.signal_quality };
  const rows = [];
  const push = (metricKey, metricName, category, value, unit) => {
    if (value == null) return;
    rows.push({
      user_id: userId,
      source: "digital_scan",
      category,
      metric_key: metricKey,
      metric_name: metricName,
      value_num: value,
      unit,
      recorded_at: recordedAt,
      raw_payload: rawPayload,
    });
  };
  push("hr_resting", "Heart Rate", "physiology", r.heart_rate_bpm, "bpm");
  push(
    "respiratory_rate",
    "Respiratory Rate",
    "physiology",
    r.respiration_rate_brpm,
    "brpm",
  );
  if (r.hrv) {
    push("hrv_rmssd", "HRV (RMSSD)", "recovery", r.hrv.rmssd_ms, "ms");
  }
  if (rows.length) {
    const { error: dbErr } = await sb.from("health_metrics").insert(rows);
    if (dbErr) console.error("[Scan] store failed:", dbErr.message);
  }
}

router.post("/rppg", upload.single("video"), async (req, res) => {
  if (!req.file || !req.file.buffer?.length) {
    return error(res, "No video uploaded", 400);
  }

  try {
    // Forward the clip to the rPPG microservice (Node 18+ global FormData/Blob).
    const form = new FormData();
    form.append(
      "video",
      new Blob([req.file.buffer], {
        type: req.file.mimetype || "video/mp4",
      }),
      req.file.originalname || "scan.mp4",
    );
    form.append("method", "auto");

    const resp = await fetch(`${RPPG_SERVICE_URL}/analyze`, {
      method: "POST",
      body: form,
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      // 422 = bad capture (no face / too short / no pulse) -> ask for a re-scan.
      if (resp.status === 422) {
        return error(
          res,
          data?.detail || "Couldn't read a clean signal — please re-scan.",
          422,
        );
      }
      console.error("[Scan] rppg service error:", resp.status, data);
      return error(res, "Scan analysis failed", 502);
    }

    await storeScan(req.user.id, data);
    return success(res, data, "Scan complete");
  } catch (e) {
    console.error("[Scan] rppg failed:", e.message);
    return error(res, "Scan failed", 500);
  }
});

module.exports = router;
