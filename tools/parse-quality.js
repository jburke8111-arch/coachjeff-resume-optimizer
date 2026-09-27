// Parse-quality metric over the labeled resume sample in tests/fixtures.
//
// The question this answers is narrow on purpose: given a resume whose correct
// structure we already know, does the parser recover it? Per fixture we check
// the fields a downstream engine actually depends on — sections found, entry
// fields, dates, bullet counts — and a fixture counts as GARBLED if any single
// check fails. Partial credit is reported (field-level accuracy) but the
// headline number is the strict one, because a resume with a swapped job title
// is wrong in the way that matters to the person using it.
//
// Deliberately simple, per the baseline issue: exact field comparison and
// bullet COUNTS, not bullet text similarity. Add fuzzier scoring only if this
// proves too blunt to show a delta.

const fs = require("fs");
const path = require("path");
const { loadLib } = require("./extract-lib.js");

const FIXTURE_DIR = path.join(__dirname, "..", "tests", "fixtures");

// Whitespace and unicode dashes/quotes vary by source document; they are not
// what we are measuring, so normalise them away before comparing.
function norm(v) {
  return String(v == null ? "" : v)
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function countBullets(bullets) {
  return (bullets || []).filter((b) => norm(b).length > 0).length;
}

// Real resumes must never be committed: this repo publishes its own root, so a
// file in tests/fixtures is a file on the public site. Anything under
// tests/fixtures/private/ is gitignored and picked up only on the machine it
// sits on — that is where real, consented resumes go.
function fixtureDirs() {
  const dirs = [FIXTURE_DIR];
  const priv = path.join(FIXTURE_DIR, "private");
  if (fs.existsSync(priv)) dirs.push(priv);
  return dirs;
}

function loadFixtures(dirs = fixtureDirs()) {
  return [].concat(...[].concat(dirs).map((dir) => fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".expected.json"))
    .sort()
    .map((f) => {
      const name = f.replace(/\.expected\.json$/, "");
      const meta = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const txtPath = path.join(dir, name + ".txt");
      if (!fs.existsSync(txtPath)) throw new Error("Fixture " + name + " has no .txt input");
      return { name, meta, text: fs.readFileSync(txtPath, "utf8") };
    })));
}

// Walks the `expect` tree and emits one check per leaf. Only fields present in
// `expect` are checked, so a fixture can assert just the part it is about.
function collectChecks(expect, actual) {
  const checks = [];
  const push = (field, exp, act) =>
    checks.push({ field, expected: norm(exp), actual: norm(act), ok: norm(exp) === norm(act) });

  if (expect.name !== undefined) push("name", expect.name, actual.name);
  if (expect.summary !== undefined) push("summary", expect.summary, actual.summary);

  if (expect.contact) {
    for (const k of Object.keys(expect.contact)) {
      push("contact." + k, expect.contact[k], (actual.contact || {})[k]);
    }
  }

  if (expect.skills) {
    for (const k of Object.keys(expect.skills)) {
      push("skills." + k, expect.skills[k], (actual.skills || {})[k]);
    }
  }

  for (const section of ["education", "experience", "projects", "activities"]) {
    if (!expect[section]) continue;
    const expList = expect[section];
    const actList = actual[section] || [];
    // Entry count is itself a check: a parser that invents or merges entries has
    // garbled the resume even if the surviving fields happen to line up.
    checks.push({
      field: section + ".count",
      expected: String(expList.length),
      actual: String(actList.length),
      ok: expList.length === actList.length,
    });
    expList.forEach((expEntry, i) => {
      const actEntry = actList[i] || {};
      for (const k of Object.keys(expEntry)) {
        if (k === "bulletCount") {
          const n = countBullets(actEntry.bullets);
          checks.push({
            field: section + "[" + i + "].bulletCount",
            expected: String(expEntry.bulletCount),
            actual: String(n),
            ok: expEntry.bulletCount === n,
          });
        } else {
          push(section + "[" + i + "]." + k, expEntry[k], actEntry[k]);
        }
      }
    });
  }
  return checks;
}

function run(opts = {}) {
  // opts.indexPath lets the sample be scored against ANY revision of the app --
  // e.g. `git show HEAD:index.html` -- which is what makes a before/after delta
  // over the same fixture set possible rather than approximate.
  const lib = loadLib(opts.indexPath);
  const fixtures = loadFixtures(opts.dir);
  const results = fixtures.map((f) => {
    let actual, error = null;
    try {
      actual = lib.mapImportedResumeToBuilder(f.text);
    } catch (err) {
      actual = {};
      error = err.message;
    }
    const checks = collectChecks(f.meta.expect || {}, actual);
    const failed = checks.filter((c) => !c.ok);
    return {
      name: f.name,
      failureMode: f.meta.failureMode || "unspecified",
      layout: f.meta.layout || "unknown",
      notes: f.meta.notes || "",
      error,
      checks: checks.length,
      passedChecks: checks.length - failed.length,
      failures: failed,
      clean: !error && failed.length === 0,
    };
  });

  const total = results.length;
  const clean = results.filter((r) => r.clean).length;
  const allChecks = results.reduce((n, r) => n + r.checks, 0);
  const allPassed = results.reduce((n, r) => n + r.passedChecks, 0);

  const byMode = {};
  for (const r of results) {
    const m = (byMode[r.failureMode] = byMode[r.failureMode] || { total: 0, clean: 0 });
    m.total++;
    if (r.clean) m.clean++;
  }

  return {
    metric: "parse-quality",
    resumes: total,
    cleanReads: clean,
    garbled: total - clean,
    garbleRate: total ? Number(((total - clean) / total).toFixed(4)) : 0,
    fieldChecks: allChecks,
    fieldsCorrect: allPassed,
    fieldAccuracy: allChecks ? Number((allPassed / allChecks).toFixed(4)) : 0,
    byFailureMode: byMode,
    results,
  };
}

function formatReport(r, { verbose = true } = {}) {
  const pct = (n) => (n * 100).toFixed(1) + "%";
  const lines = [];
  lines.push("Parse quality — " + r.resumes + " resumes in the labeled sample");
  lines.push("");
  lines.push("  Garble rate     " + pct(r.garbleRate) + "  (" + r.garbled + " of " + r.resumes + " resumes have at least one wrong field)");
  lines.push("  Clean reads     " + r.cleanReads + " of " + r.resumes);
  lines.push("  Field accuracy  " + pct(r.fieldAccuracy) + "  (" + r.fieldsCorrect + " of " + r.fieldChecks + " field checks)");
  lines.push("");
  lines.push("  By failure mode:");
  for (const [mode, m] of Object.entries(r.byFailureMode).sort()) {
    lines.push("    " + mode.padEnd(22) + m.clean + "/" + m.total + " clean");
  }
  if (verbose) {
    lines.push("");
    for (const res of r.results) {
      lines.push((res.clean ? "  PASS  " : "  FAIL  ") + res.name + (res.error ? "  [threw: " + res.error + "]" : ""));
      for (const f of res.failures) {
        lines.push("          " + f.field + ": expected " + JSON.stringify(f.expected) + ", got " + JSON.stringify(f.actual));
      }
    }
  }
  return lines.join("\n");
}

module.exports = { run, formatReport, loadFixtures, fixtureDirs, collectChecks, FIXTURE_DIR };

if (require.main === module) {
  const argIdx = process.argv.indexOf("--index");
  const r = run(argIdx !== -1 ? { indexPath: process.argv[argIdx + 1] } : {});
  console.log(formatReport(r, { verbose: !process.argv.includes("--quiet") }));
}
