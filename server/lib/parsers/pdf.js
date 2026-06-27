'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

// pdfjs-dist's Node-compatible build is ESM-only; load it lazily via dynamic
// import from this CommonJS module. We use the actively-maintained Mozilla
// pdf.js rather than the long-unmaintained `pdf-parse` package, which bundles
// a years-old pdf.js that fails on PDFs using modern (compressed) xref
// streams - including, notably, PDFs produced by this app's own pdf-lib
// based builder.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

const STANDARD_FONT_DATA_URL = pathToFileURL(
  path.join(require.resolve('pdfjs-dist/package.json'), '..', 'standard_fonts') + path.sep
).href;

/**
 * Parse a PDF buffer into a paragraph-block model: { blocks: [{type:'paragraph', text}] }
 *
 * PDF has no semantic structure (no real heading/paragraph markup), so we
 * reconstruct paragraphs from line breaks (using each text item's vertical
 * position) and use a heuristic to detect heading-like short, title-cased
 * standalone lines.
 */
async function parsePdf(buffer) {
  const pdfjsLib = await loadPdfjs();
  const data = new Uint8Array(buffer);

  // Text extraction never needs glyph rendering, so font-loading warnings
  // (pdfjs's Node build can't always fetch its own bundled font files via
  // file:// URLs in this runtime) are expected noise here - pass ERRORS-only
  // verbosity so they don't spam stderr on every request.
  let doc;
  try {
    doc = await pdfjsLib.getDocument({
      data,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      disableFontFace: true,
      useSystemFonts: false,
      isEvalSupported: false,
      verbosity: pdfjsLib.VerbosityLevel?.ERRORS ?? 0,
    }).promise;
  } catch (err) {
    const wrapped = new Error(`Could not read this PDF: ${err.message}`);
    wrapped.code = 'PDF_PARSE_FAILED';
    throw wrapped;
  }

  const lines = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    let currentLine = [];
    let lastY = null;
    for (const item of content.items) {
      if (!item.str) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (currentLine.length) lines.push(currentLine.join('').trim());
        currentLine = [];
      }
      currentLine.push(item.str + (item.hasEOL ? '' : ' '));
      lastY = y;
    }
    if (currentLine.length) lines.push(currentLine.join('').trim());
    lines.push(''); // page break = paragraph break
  }

  const blocks = [];
  let buffer_ = [];

  const flush = () => {
    if (buffer_.length) {
      blocks.push({ type: 'paragraph', text: buffer_.join(' ').replace(/\s+/g, ' ').trim() });
      buffer_ = [];
    }
  };

  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    if (looksLikeHeading(line)) {
      flush();
      blocks.push({ type: 'heading', level: 2, text: line });
    } else if (/^[\u2022\-*]\s/.test(line)) {
      flush();
      const items = line
        .split(/(?=[\u2022\-*]\s)/)
        .map((s) => s.replace(/^[\u2022\-*]\s*/, '').trim())
        .filter(Boolean);
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock && lastBlock.type === 'list') {
        lastBlock.items.push(...items);
      } else {
        blocks.push({ type: 'list', ordered: false, items });
      }
    } else {
      buffer_.push(line);
    }
  }
  flush();

  const nonEmpty = blocks.filter((b) =>
    b.type === 'list' ? b.items.length > 0 : Boolean(b.text && b.text.trim())
  );
  return { blocks: nonEmpty, pageCount: doc.numPages };
}

function looksLikeHeading(line) {
  if (line.length > 70) return false;
  if (/[.;:,]$/.test(line)) return false;
  // Table rows reconstructed from PDF text positions often come through as
  // short, capitalized, punctuation-free lines too - exactly what a heading
  // looks like. The distinguishing signal is multiple wide gaps between
  // tokens (column separation), which real headings don't have.
  if (/\s{2,}/.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length > 10) return false;
  const titleCaseWords = words.filter((w) => /^[A-Z0-9]/.test(w));
  return titleCaseWords.length / words.length > 0.6;
}

module.exports = { parsePdf };
