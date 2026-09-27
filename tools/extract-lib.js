// Extracts the Resume Optimizer's pure logic out of index.html so it can be
// loaded and tested under Node.
//
// The app ships as a single self-contained index.html with no build step, which
// is deliberate — it deploys as a static file. That means the parsing and
// scoring functions live inside a <script type="text/jsx-app"> block and cannot
// be imported. Rather than split the app into modules (a much larger change
// than the testing work requires), we slice the pure-function region out by
// marker comments and evaluate it in isolation.
//
// Markers, not line numbers: an earlier version of this harness sliced by line
// number and broke on every edit above the cut point.

const fs = require("fs");
const path = require("path");

const INDEX_PATH = path.join(__dirname, "..", "index.html");
const START_MARKER = "// ===== LIB START =====";
const END_MARKER = "// ===== LIB END =====";

function extractLibSource(indexPath = INDEX_PATH) {
  const html = fs.readFileSync(indexPath, "utf8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start !== -1 && end !== -1) {
    if (end < start) throw new Error("LIB END appears before LIB START in " + indexPath);
    return html.slice(start + START_MARKER.length, end);
  }
  // Revisions from before the markers existed (anything older than the baseline
  // work) can still be scored: the markers were placed at exactly these two
  // boundaries, so falling back to them lets `--index` measure any past version
  // of the app against the same fixture sample.
  const legacyStart = html.indexOf("const { useState");
  const legacyEnd = html.indexOf("\nfunction App()");
  if (legacyStart === -1 || legacyEnd === -1 || legacyEnd < legacyStart) {
    throw new Error("No LIB markers and no recognisable lib boundaries in " + indexPath);
  }
  const afterDestructure = html.indexOf("\n", legacyStart);
  return html.slice(afterDestructure, legacyEnd);
}

// Top-level declarations become the library's exports. Discovered by shape
// rather than kept in a hand-maintained list, so a newly added function is
// testable immediately and this file never goes stale.
function topLevelNames(src) {
  const names = new Set();
  const re = /^(?:async\s+)?(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  return [...names];
}

// The lib is browser code. At module scope it must not touch the DOM, but a few
// functions reference `window` lazily inside their bodies (CDN loaders for
// PDF.js, mammoth, JSZip). Those are never called by the parse tests; the stub
// just keeps the reference from throwing if one is reached.
function loadLib(indexPath = INDEX_PATH) {
  const src = extractLibSource(indexPath);
  const names = topLevelNames(src);
  const preamble = "var window = arguments[0];\n";
  const epilogue = "\n;return { " + names.join(", ") + " };";
  let factory;
  try {
    factory = new Function(preamble + src + epilogue);
  } catch (err) {
    throw new Error("Extracted lib failed to parse: " + err.message);
  }
  return factory({ location: { href: "" } });
}

module.exports = { extractLibSource, topLevelNames, loadLib, INDEX_PATH };

if (require.main === module) {
  const src = extractLibSource();
  const names = topLevelNames(src);
  process.stderr.write(
    "extracted " + src.split("\n").length + " lines, " + names.length + " top-level declarations\n"
  );
  process.stdout.write(src);
}
