/**
 * Dev-time parity check: runs the golden fixtures (produced by the Python oracle
 * at /tmp/biyo-oracle/oracle.py) through the JS engine and asserts numeric +
 * categorical parity. Not shipped — a correctness gate for the port.
 *
 * Run:  node services/scoring/_validate.js
 */
const fs = require("fs");
const scoring = require("./index");

const GOLDEN = process.env.GOLDEN || "/tmp/biyo-oracle/golden.json";
const TOL = 0.1;
const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));

const CALL = {
  heart: (i, td) => scoring.scoreHeartCirculation(i.today, i.history, i.profile, td),
  movement: (i, td) => scoring.scoreMovementQuality(i.today, i.history, i.profile, td),
  weight: (i, td) => scoring.scoreWeightManagement(i.today, i.history, i.profile, td),
  mind: (i, td) => scoring.scoreMindFocus(i.today, i.history, i.profile, td),
  oxygen: (i, td) => scoring.scoreOxygenBreathing(i.today, i.history, i.profile, td),
  lifestyle: (i, td) => scoring.scoreLifestyleIndex(i.today, i.history, i.profile, i.scores_history, td),
};

function approx(a, b, diffs, label) {
  if (a == null || b == null) {
    if (a == null && b == null) return 0;
    diffs.push(`${label}: expected ${a}, got ${b}`);
    return Infinity;
  }
  const d = Math.abs(a - b);
  if (d > TOL + 1e-9) diffs.push(`${label}: expected ${a}, got ${b} (Δ${d.toFixed(4)})`);
  return d;
}

let pass = 0;
let fail = 0;
let maxDiff = 0;
const rows = [];

for (const fx of golden) {
  const diffs = [];
  let localMax = 0;
  const exp = fx.expected;
  let act;
  try {
    act = CALL[fx.score_fn](fx.inputs, fx.today_date);
  } catch (e) {
    diffs.push(`threw: ${e.message}`);
    fail++;
    rows.push([fx.name, "FAIL", diffs.join("; ")]);
    continue;
  }

  // key parity
  const ek = Object.keys(exp).sort().join(",");
  const ak = Object.keys(act).sort().join(",");
  if (ek !== ak) diffs.push(`keys: expected [${ek}] got [${ak}]`);

  localMax = Math.max(localMax, approx(exp.score, act.score, diffs, "score"));
  localMax = Math.max(localMax, approx(exp.confidence, act.confidence, diffs, "confidence"));

  if ("status_chip" in exp || "status_chip" in act) {
    if (exp.status_chip !== act.status_chip) diffs.push(`status_chip: "${exp.status_chip}" vs "${act.status_chip}"`);
  }
  if (exp.baseline_status !== act.baseline_status) {
    diffs.push(`baseline_status: "${exp.baseline_status}" vs "${act.baseline_status}"`);
  }
  if (JSON.stringify(exp.data_sources_used) !== JSON.stringify(act.data_sources_used)) {
    diffs.push(`data_sources_used: ${JSON.stringify(exp.data_sources_used)} vs ${JSON.stringify(act.data_sources_used)}`);
  }
  if (exp.disclaimer !== act.disclaimer) diffs.push("disclaimer mismatch");

  const ep = exp.pillars || {};
  const ap = act.pillars || {};
  const pk = Object.keys(ep);
  const pkA = Object.keys(ap);
  if (pk.sort().join(",") !== pkA.sort().join(",")) {
    diffs.push(`pillar keys differ: [${pk}] vs [${pkA}]`);
  }
  for (const name of pk) {
    const e = ep[name] || {};
    const a = ap[name] || {};
    if (e.available !== a.available) diffs.push(`${name}.available: ${e.available} vs ${a.available}`);
    localMax = Math.max(localMax, approx(e.weight, a.weight, diffs, `${name}.weight`));
    localMax = Math.max(localMax, approx(e.score, a.score, diffs, `${name}.score`));
  }

  if (Number.isFinite(localMax)) maxDiff = Math.max(maxDiff, localMax);
  if (diffs.length === 0) {
    pass++;
    rows.push([fx.name, "PASS", `maxΔ ${localMax.toFixed(4)}`]);
  } else {
    fail++;
    rows.push([fx.name, "FAIL", diffs.join("; ")]);
  }
}

const w = Math.max(...golden.map((f) => f.name.length), 10);
for (const [name, status, detail] of rows) {
  const mark = status === "PASS" ? "✓" : "✗";
  console.log(`${mark} ${name.padEnd(w)}  ${status}  ${detail}`);
}
console.log("");
console.log(`RESULT: ${pass}/${golden.length} fixtures passing, ${fail} failing. Max numeric Δ = ${maxDiff.toFixed(5)}`);
process.exit(fail === 0 ? 0 : 1);
