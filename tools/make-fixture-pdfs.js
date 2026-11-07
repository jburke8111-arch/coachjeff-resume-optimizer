// Rebuilds the PDF fixtures from their HTML sources in tests/fixtures/src/.
//
// Real resumes cannot be committed (this repo publishes its own root), so the
// shared sample's PDFs are made-up resumes laid out to reproduce real failures.
// Keeping the HTML as the source means a reviewer can read exactly what a PDF
// fixture contains, and anyone can regenerate it:
//
//   npm run make-fixture-pdfs
//
// Uses a Chromium browser in headless mode (Edge ships with Windows; Chrome or
// Chromium work too). Set CHROME_PATH to use a specific browser.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("url");
const os = require("os");

const SRC_DIR = path.join(__dirname, "..", "tests", "fixtures", "src");
const OUT_DIR = path.join(__dirname, "..", "tests", "fixtures");

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("No Chromium browser found. Set CHROME_PATH to Edge, Chrome or Chromium.");
  return found;
}

const browser = findBrowser();
const sources = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith(".html"));
for (const f of sources) {
  const out = path.join(OUT_DIR, f.replace(/\.html$/, ".pdf"));
  execFileSync(browser, [
    "--headless=new",
    // A throwaway profile forces a separate browser process. Without it, a
    // browser that is already open takes the job over and this one exits
    // without writing the PDF.
    "--user-data-dir=" + path.join(os.tmpdir(), "resume-fixture-pdf-profile"),
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--print-to-pdf-no-header",
    "--print-to-pdf=" + out,
    pathToFileURL(path.join(SRC_DIR, f)).href,
  ], { stdio: "ignore", timeout: 60000 });
  if (!fs.existsSync(out)) throw new Error("browser exited without writing " + out);
  console.log("built " + path.relative(process.cwd(), out));
}
