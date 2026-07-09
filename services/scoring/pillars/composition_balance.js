// PILLAR 1 (Weight) — COMPOSITION BALANCE. 60% trend + 40% absolute w/ under-fat gate.
const {
  BODY_FAT_CENTRE,
  BODY_FAT_SIGMA,
  UNDER_FAT_FLOOR,
  UNDER_FAT_PENALTY,
  SMMI_REFERENCE,
  SMMI_SIGMA,
  P1_TREND_WEIGHT,
  P1_ABSOLUTE_WEIGHT,
} = require("../config");
const { sigmoidScore, trendScore, pyRound } = require("../utils");
const { winsorise } = require("../baseline");

function _absoluteComponent(fatPct, smm, profile) {
  const sex = profile.sex;
  const heightM = (profile.height_cm || 170) / 100.0;
  const centre = BODY_FAT_CENTRE[sex] ?? 22.0;
  const base = sigmoidScore(fatPct, centre, BODY_FAT_SIGMA, false);

  const floor = UNDER_FAT_FLOOR[sex] ?? 14.0;
  if (fatPct >= floor) return base;

  if (smm == null || heightM <= 0) {
    const deficit = (floor - fatPct) / floor;
    return Math.max(0.0, base - UNDER_FAT_PENALTY * deficit);
  }

  const smmi = smm / (heightM * heightM);
  const smmiRef = SMMI_REFERENCE[sex] ?? 9.0;
  const protection = Math.max(0.0, Math.min(1.0, (smmi - smmiRef) / (1.5 * SMMI_SIGMA)));
  const deficit = (floor - fatPct) / floor;
  const penalty = UNDER_FAT_PENALTY * deficit * (1.0 - protection);
  return Math.max(0.0, base - penalty);
}

function _trendComponent(fatPctToday, bl) {
  if (!bl.trend_ready || bl.mean_14d == null || !bl.sd_14d) return null;
  return trendScore(fatPctToday, bl.mean_14d, Math.max(bl.sd_14d, 0.5), true);
}

function scoreCompositionBalance(today, baseline, profile) {
  let fatPct = today.fat_ratio_pct;
  if (fatPct == null) return null;

  const blFat = baseline.fat_ratio_pct || {};
  fatPct = winsorise(fatPct, blFat);

  const absolute = _absoluteComponent(fatPct, today.skeletal_muscle_mass_kg, profile);
  const trend = _trendComponent(fatPct, blFat);

  if (trend == null) return pyRound(absolute, 2);

  const blended = P1_TREND_WEIGHT * trend + P1_ABSOLUTE_WEIGHT * absolute;
  return pyRound(blended, 2);
}

module.exports = { scoreCompositionBalance };
