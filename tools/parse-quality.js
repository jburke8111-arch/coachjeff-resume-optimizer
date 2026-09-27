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
//
// Inputs can be .txt (pasted text) or .pdf. A PDF goes through the app's own
// extractPdfTextFromFile(), so the PDF.js line reconstruction — the step most
// likely to garble a real upload — is measured, not skipped.

const fs = require("fs");
const path = require("path");
const { loadLib } = require("./extract-lib.js");

const FIXTURE_DIR = path.join(__dirname, "..", "tests", "fixtures");
const PRIVATE_DIR = path.join(FIXTURE_DIR, "private");
const INPUT_KINDS = ["pdf", "txt"];

// Whitespace and unicode dashes/quotes vary by source document; they are not
// what we are measuring, so normalise them away before comparing.
function norm(v) {
  return String(v == null ? "" : v)
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function countBullets(bullets) {
  return (bullets || []).filter((b) => norm(b).length > 0).length;
}

// Characters that render as an empty box: Private Use Area code points (Word's
// Symbol/Wingdings bullets arrive as U+F0B7 and friends) and the replacement
// character. A bullet that starts with one still counts toward bulletCount, so
// without this check the most visible PDF bug — a box on every bullet, carried
// into the exported resume — would pass unnoticed.
const UNREADABLE = /[\uE000-\uF8FF\uFFFD]/g;

function countUnreadable(value) {
  let n = 0;
  const walk = (v) => {
    if (typeof v === "string") n += (v.match(UNREADABLE) || []).length;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return n;
}

// Real resumes must never be committed: this repo publishes its own root, so a
// file in tests/fixtures is a file on the public site. tests/fixtures/private/
// is gitignored; fixtures there are scored on the machine they sit on and
// reported separately, so the committed numbers stay reproducible for everyone.
function fixtureDirs() {
  const dirs = [{ dir: FIXTURE_DIR, isPrivate: false }];
  if (fs.existsSync(PRIVATE_DIR)) dirs.push({ dir: PRIVATE_DIR, isPrivate: true });
  return dirs;
}

function loadFixtures(dirs = fixtureDirs()) {
  const out = [];
  for (const { dir, isPrivate } of dirs) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".expected.json")).sort()) {
      const name = f.replace(/\.expected\.json$/, "");
      const meta = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const kind = INPUT_KINDS.find((k) => fs.existsSync(path.join(dir, name + "." + k)));
      if (!kind) throw new Error("Fixture " + name + " has no ." + INPUT_KINDS.join(" or .") + " input");
      out.push({ name, meta, kind, inputPath: path.join(dir, name + "." + kind), isPrivate });
    }
  }
  return out;
}

// Walks the `expect` tree and emits one check per leaf. Only fields present in
// `expect` are checked, so a fixture can assert just the part it is about.
function collectChecks(expect, actual) {
  const checks = [];
  const push = (field, exp, act) =>
    checks.push({ field, expected: norm(exp), actual: norm(act), ok: norm(exp) === norm(act) });
  // contact / skills can nest (skills.labels.technical); compare leaf by leaf.
  const pushTree = (prefix, exp, act) => {
    for (const k of Object.keys(exp)) {
      const e = exp[k];
      const a = (act || {})[k];
      if (e && typeof e === "object" && !Array.isArray(e)) pushTree(prefix + "." + k, e, a);
      else push(prefix + "." + k, e, a);
    }
  };

  if (expect.name !== undefined) push("name", expect.name, actual.name);
  if (expect.summary !== undefined) push("summary", expect.summary, actual.summary);
  if (expect.contact) pushTree("contact", expect.contact, actual.contact);
  if (expect.skills) pushTree("skills", expect.skills, actual.skills);

  for (const section of ["education", "experience", "projects", "activities", "certifications", "awards"]) {
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

  // Applied to every fixture, not opt-in: an unreadable glyph anywhere in the
  // parsed resume ends up in the export.
  const unreadable = countUnreadable(actual);
  checks.push({ field: "unreadableChars", expected: "0", actual: String(unreadable), ok: unreadable === 0 });
  return checks;
}

function summarise(results) {
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
    resumes: total,
    cleanReads: clean,
    garbled: total - clean,
    garbleRate: total ? Number(((total - clean) / total).toFixed(4)) : 0,
    fieldChecks: allChecks,
    fieldsCorrect: allPassed,
    fieldAccuracy: allChecks ? Number((allPassed / allChecks).toFixed(4)) : 0,
    byFailureMode: byMode,
  };
}

async function run(opts = {}) {
  const fixtures = loadFixtures(opts.dirs);
  // PDF.js is only loaded when a PDF fixture exists, so a text-only run needs
  // nothing beyond the lib itself.
  const needsPdf = fixtures.some((f) => f.kind === "pdf");
  const windowStub = needsPdf ? require("./pdf-node.js").pdfWindow() : undefined;
  // opts.indexPath lets the sample be scored against ANY revision of the app --
  // e.g. `git show HEAD:index.html` -- which is what makes a before/after delta
  // over the same fixture set possible rather than approximate.
  const lib = loadLib(opts.indexPath, windowStub);

  const results = [];
  for (const f of fixtures) {
    let actual = {};
    let error = null;
    try {
      const text = f.kind === "pdf"
        ? await lib.extractPdfTextFromFile(require("./pdf-node.js").fileFromPath(f.inputPath))
        : fs.readFileSync(f.inputPath, "utf8");
      actual = lib.mapImportedResumeToBuilder(text);
    } catch (err) {
      error = err.message;
    }
    const checks = collectChecks(f.meta.expect || {}, actual);
    const failed = checks.filter((c) => !c.ok);
    results.push({
      name: f.name,
      kind: f.kind,
      isPrivate: f.isPrivate,
      failureMode: f.meta.failureMode || "unspecified",
      layout: f.meta.layout || "unknown",
      notes: f.meta.notes || "",
      error,
      checks: checks.length,
      passedChecks: checks.length - failed.length,
      failures: failed,
      clean: !error && failed.length === 0,
    });
  }

  const shared = results.filter((r) => !r.isPrivate);
  return {
    metric: "parse-quality",
    ...summarise(shared),
    results: shared,
    privateResults: results.filter((r) => r.isPrivate),
  };
}

function formatResult(res) {
  const lines = [(res.clean ? "  PASS  " : "  FAIL  ") + res.name + (res.kind === "pdf" ? " (pdf)" : "") +
    (res.error ? "  [threw: " + res.error + "]" : "")];
  for (const f of res.failures) {
    lines.push("          " + f.field + ": expected " + JSON.stringify(f.expected) + ", got " + JSON.stringify(f.actual));
  }
  return lines;
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
    for (const res of r.results) lines.push(...formatResult(res));
  }
  if (r.privateResults && r.privateResults.length) {
    lines.push("");
    lines.push("  Private fixtures (this machine only; not in the numbers above):");
    for (const res of r.privateResults) lines.push(...formatResult(res));
  }
  return lines.join("\n");
}

module.exports = { run, formatReport, loadFixtures, fixtureDirs, collectChecks, countUnreadable, FIXTURE_DIR };

if (require.main === module) {
  const argIdx = process.argv.indexOf("--index");
  run(argIdx !== -1 ? { indexPath: process.argv[argIdx + 1] } : {})
    .then((r) => console.log(formatReport(r, { verbose: !process.argv.includes("--quiet") })))
    .catch((err) => { console.error(err); process.exit(1); });
}
