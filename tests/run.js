// Test gate for parse quality.
//
// Compares the current parse-quality run against the committed snapshot in
// tests/baseline.json and reports the delta. The gate is asymmetric on purpose:
//
//   - a fixture that was clean and is now garbled FAILS the run (regression)
//   - a fixture that was garbled and is now clean is reported as the win
//
// That asymmetry is what lets parser work proceed safely: fixtures are expected
// to start failing (they encode known bugs), so "all green" is not the bar.
// "Nothing that worked stopped working, and the garble rate went down" is.
//
//   node tests/run.js                    check against the baseline
//   node tests/run.js --update-baseline  re-snapshot after an intended change

const fs = require("fs");
const path = require("path");
const { run, formatReport } = require("../tools/parse-quality.js");

const BASELINE_PATH = path.join(__dirname, "baseline.json");

function snapshot(r, revision) {
  return {
    recordedAt: new Date().toISOString().slice(0, 10),
    metric: r.metric,
    revision: revision || "working tree",
    resumes: r.resumes,
    garbleRate: r.garbleRate,
    fieldAccuracy: r.fieldAccuracy,
    perFixture: Object.fromEntries(r.results.map((x) => [x.name, x.clean ? "clean" : "garbled"])),
  };
}

// --index <path> scores a different revision of index.html, so a baseline can
// be recorded for the code as it stood BEFORE a change, not after it. That is
// what makes the reported delta a real before/after over one fixture set.
const idxArg = process.argv.indexOf("--index");
const scoredRevision = idxArg !== -1 ? process.argv[idxArg + 1] : null;
const result = run(scoredRevision ? { indexPath: scoredRevision } : {});
console.log(formatReport(result));
console.log("");

if (process.argv.includes("--update-baseline")) {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(snapshot(result, scoredRevision), null, 2) + "\n");
  console.log("Baseline updated: " + path.relative(process.cwd(), BASELINE_PATH));
  process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error("No baseline recorded yet. Run: npm run baseline");
  process.exit(1);
}

const base = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
const regressions = [];
const fixes = [];
const added = [];

for (const r of result.results) {
  const before = base.perFixture[r.name];
  if (before === undefined) { added.push(r.name); continue; }
  if (before === "clean" && !r.clean) regressions.push(r.name);
  if (before === "garbled" && r.clean) fixes.push(r.name);
}
const removed = Object.keys(base.perFixture).filter((n) => !result.results.some((r) => r.name === n));

const pct = (n) => (n * 100).toFixed(1) + "%";
const delta = result.garbleRate - base.garbleRate;
console.log("Versus baseline recorded " + base.recordedAt + ":");
console.log("  Garble rate  " + pct(base.garbleRate) + " -> " + pct(result.garbleRate) +
  "  (" + (delta === 0 ? "no change" : (delta < 0 ? "down " : "up ") + pct(Math.abs(delta))) + ")");
console.log("  Field acc.   " + pct(base.fieldAccuracy) + " -> " + pct(result.fieldAccuracy));
if (fixes.length) console.log("  Now parsing cleanly: " + fixes.join(", "));
if (added.length) console.log("  New fixtures (not in baseline): " + added.join(", "));
if (removed.length) console.log("  Fixtures removed since baseline: " + removed.join(", "));

if (regressions.length) {
  console.error("");
  console.error("REGRESSION — these parsed cleanly at baseline and no longer do:");
  for (const n of regressions) console.error("  " + n);
  console.error("");
  console.error("Fix the regression, or re-snapshot with `npm run baseline` if the change was intended.");
  process.exit(1);
}

console.log("");
console.log("No regressions.");
