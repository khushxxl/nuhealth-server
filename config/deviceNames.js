// Bodyscale BLE/device naming. Kept in sync with biyo/utils/device-names.ts.
// The Lefu hardware ships under two product names — Nubody+ (legacy) and Biyo
// (new). We store every scale row as "Nubody+" regardless of the broadcast
// name so downstream queries don't need to handle both variants.

const BODYSCALE_NAME_HINTS = ["nubody", "biyo"];

const CANONICAL_BODYSCALE_NAME = "Nubody+";

function isBodyscaleDeviceName(name) {
  if (!name) return false;
  return BODYSCALE_NAME_HINTS.some((h) => String(name).toLowerCase().includes(h));
}

function canonicaliseScaleName(name) {
  if (!name) return CANONICAL_BODYSCALE_NAME;
  return String(name).toLowerCase().includes("biyo")
    ? CANONICAL_BODYSCALE_NAME
    : name;
}

module.exports = {
  BODYSCALE_NAME_HINTS,
  CANONICAL_BODYSCALE_NAME,
  isBodyscaleDeviceName,
  canonicaliseScaleName,
};
