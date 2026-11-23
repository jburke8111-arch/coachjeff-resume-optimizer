// Lets the tests read .docx resumes with the same call the app makes.
//
// In the browser, the import path for a Word file is
//   mammoth.convertToHtml({ arrayBuffer })  ->  docxHtmlToText(result.value)
// (see the ".docx" branch of the file-import function in index.html). Here we
// call the same mammoth release (1.7.2, the version the app loads from the CDN)
// with a Node Buffer instead of an ArrayBuffer, then run the app's
// docxHtmlToText and use its raw-text fallback when the HTML is empty.

const fs = require("fs");

async function extractDocxText(filePath, lib) {
  const mammoth = require("mammoth");
  const input = { buffer: fs.readFileSync(filePath) };
  const result = await mammoth.convertToHtml(input);
  const text = lib.docxHtmlToText(result.value);
  if (text) return text;
  return ((await mammoth.extractRawText(input)).value || "").trim();
}

module.exports = { extractDocxText };
