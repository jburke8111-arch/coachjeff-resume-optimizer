// Guards the one failure that takes the whole app down.
//
// index.html has no build step: the JSX in <script type="text/jsx-app"> is
// compiled by Babel in the visitor's browser on every page load. A syntax error
// anywhere in those ~7,000 lines does not fail at deploy time — it fails for
// the user, as "Something went wrong starting the app", with a blank tool.
//
// This reproduces the browser's exact startup path (same Babel version, same
// preset, same `new Function` construction) so that failure surfaces in CI
// instead of in production.

const fs = require("fs");
const path = require("path");
const Babel = require("@babel/standalone");

const INDEX_PATH = path.join(__dirname, "..", "index.html");
const OPEN_TAG = /<script type="text\/jsx-app"[^>]*>/;
const CLOSE_TAG = "\n</script>";

function extractAppSource(indexPath = INDEX_PATH) {
  const html = fs.readFileSync(indexPath, "utf8");
  const open = html.match(OPEN_TAG);
  if (!open) throw new Error('No <script type="text/jsx-app"> block found');
  const start = open.index + open[0].length;
  const end = html.indexOf(CLOSE_TAG, start);
  if (end === -1) throw new Error("Unterminated jsx-app script block");
  return html.slice(start, end);
}

function checkAppCompiles(indexPath = INDEX_PATH) {
  const src = extractAppSource(indexPath);
  // Same call the page makes in its compileAndRun().
  const out = Babel.transform(src, { presets: ["react"] }).code;
  // Same construction the page makes. Catches strict-mode and top-level issues
  // that survive parsing.
  new Function(out);
  return { sourceLines: src.split("\n").length, compiledChars: out.length };
}

module.exports = { extractAppSource, checkAppCompiles };

if (require.main === module) {
  try {
    const r = checkAppCompiles();
    console.log("App compiles: " + r.sourceLines + " lines of JSX -> " + r.compiledChars + " chars, constructs cleanly.");
  } catch (err) {
    console.error("APP WOULD NOT START IN A BROWSER:");
    console.error("  " + err.message);
    process.exit(1);
  }
}
