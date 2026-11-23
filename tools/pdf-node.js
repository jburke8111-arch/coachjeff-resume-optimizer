// Lets the tests read PDFs with the app's OWN extraction code.
//
// In the browser, extractPdfTextFromFile() loads PDF.js from a CDN and reads
// window.pdfjsLib. Here we hand it the same PDF.js release from node_modules
// (pinned to the version index.html loads, 3.11.174) so a PDF fixture goes
// through exactly the line-reconstruction logic users get — which is the part
// of the import most likely to garble a resume, and the part a .txt fixture
// never exercises.

const fs = require("fs");
const path = require("path");

let cached = null;

function pdfWindow() {
  if (cached) return cached;
  // On load, PDF.js tries to polyfill canvas APIs it needs only for drawing
  // pages, and prints two alarming "rendering may be broken" warnings when the
  // optional canvas package is absent. Text extraction does not use canvas,
  // so the warnings are noise here; mute them for just the require.
  const { log, warn } = console;
  console.log = console.warn = () => {};
  let pdfjs;
  try { pdfjs = require("pdfjs-dist/legacy/build/pdf.js"); }
  finally { console.log = log; console.warn = warn; }
  // Run PDF.js's worker in-process. Without this it tries to spawn one from a
  // URL, which under Node means require()-ing the CDN address the app sets.
  globalThis.pdfjsWorker = require("pdfjs-dist/legacy/build/pdf.worker.js");
  cached = {
    location: { href: "" },
    pdfjsLib: {
      // The app assigns a CDN workerSrc here on every import. Give it an object
      // of its own to write to so that assignment can't reach real PDF.js.
      GlobalWorkerOptions: {},
      getDocument: (params) =>
        pdfjs.getDocument({
          ...params,
          // The app passes an ArrayBuffer; hand PDF.js a fresh typed-array view
          // so it can't detach a buffer the caller still holds.
          data: new Uint8Array(params.data),
          verbosity: 0,
          isEvalSupported: false,
          useSystemFonts: false,
        }),
    },
  };
  return cached;
}

// The browser passes a File; the app only calls .name and .arrayBuffer().
function fileFromPath(filePath) {
  const buf = fs.readFileSync(filePath);
  return {
    name: path.basename(filePath),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

module.exports = { pdfWindow, fileFromPath };
