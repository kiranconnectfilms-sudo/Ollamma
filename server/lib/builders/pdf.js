'use strict';

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const TITLE_COLOR = rgb(0.10, 0.10, 0.18);
const BODY_COLOR = rgb(0.15, 0.15, 0.15);

/**
 * Build a PDF Buffer from a block list: { blocks: [{type, level, text, items, rows}] }
 * Implements manual word-wrap and pagination since pdf-lib has no text-flow layer.
 */
async function buildPdf(blocks, title) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursorY = PAGE_HEIGHT - MARGIN;
  };

  const ensureSpace = (needed) => {
    if (cursorY - needed < MARGIN) newPage();
  };

  const drawWrapped = (text, { font, size, color, x = MARGIN, maxWidth = CONTENT_WIDTH, lineGap = 4, indent = 0 }) => {
    const words = text.split(/\s+/).filter(Boolean);
    let line = '';
    const lines = [];
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(trial, size) > maxWidth - indent && line) {
        lines.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    if (line) lines.push(line);

    for (const l of lines) {
      ensureSpace(size + lineGap);
      page.drawText(l, { x: x + indent, y: cursorY - size, size, font, color });
      cursorY -= size + lineGap;
    }
  };

  if (title) {
    drawWrapped(title, { font: bold, size: 22, color: TITLE_COLOR });
    cursorY -= 10;
  }

  for (const block of blocks) {
    if (block.type === 'heading') {
      ensureSpace(30);
      cursorY -= 8;
      const size = block.level <= 2 ? 17 : 14;
      drawWrapped(block.text, { font: bold, size, color: TITLE_COLOR });
      cursorY -= 4;
    } else if (block.type === 'paragraph') {
      drawWrapped(block.text, { font: regular, size: 11, color: BODY_COLOR, lineGap: 5 });
      cursorY -= 8;
    } else if (block.type === 'list') {
      for (const item of block.items) {
        drawWrapped(`\u2022  ${item}`, { font: regular, size: 11, color: BODY_COLOR, indent: 4 });
      }
      cursorY -= 6;
    } else if (block.type === 'table' && block.rows.length) {
      cursorY -= 4;
      const colCount = Math.max(...block.rows.map((r) => r.length));
      const colWidth = CONTENT_WIDTH / colCount;
      for (let r = 0; r < block.rows.length; r++) {
        ensureSpace(20);
        const rowY = cursorY;
        const font = r === 0 ? bold : regular;
        block.rows[r].forEach((cell, c) => {
          const truncated = truncateToWidth(String(cell ?? ''), font, 10, colWidth - 8);
          page.drawText(truncated, {
            x: MARGIN + c * colWidth,
            y: rowY - 12,
            size: 10,
            font,
            color: r === 0 ? TITLE_COLOR : BODY_COLOR,
          });
        });
        page.drawLine({
          start: { x: MARGIN, y: rowY - 16 },
          end: { x: MARGIN + CONTENT_WIDTH, y: rowY - 16 },
          thickness: 0.5,
          color: rgb(0.85, 0.85, 0.85),
        });
        cursorY -= 20;
      }
      cursorY -= 10;
    }
  }

  return Buffer.from(await pdf.save());
}

function truncateToWidth(text, font, size, maxWidth) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && font.widthOfTextAtSize(truncated + '…', size) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '…';
}

module.exports = { buildPdf };
