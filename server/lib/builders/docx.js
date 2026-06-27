'use strict';

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  LevelFormat,
  BorderStyle,
  WidthType,
  ShadingType,
} = require('docx');

const PAGE = {
  width: 12240, // US Letter, DXA
  height: 15840,
  margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
};
const CONTENT_WIDTH = PAGE.width - PAGE.margin.left - PAGE.margin.right; // 9360

const HEADING_MAP = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const TABLE_BORDERS = {
  top: TABLE_BORDER,
  bottom: TABLE_BORDER,
  left: TABLE_BORDER,
  right: TABLE_BORDER,
};

function textRunsFromMarkup(text) {
  // Supports simple **bold** markup the AI may produce; everything else is plain text.
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return new TextRun({ text: part.slice(2, -2), bold: true });
    }
    return new TextRun({ text: part });
  });
}

function blockToDocxElements(block, numberingRef) {
  if (block.type === 'heading') {
    return [
      new Paragraph({
        heading: HEADING_MAP[Math.min(block.level, 6)] || HeadingLevel.HEADING_2,
        children: textRunsFromMarkup(block.text),
      }),
    ];
  }

  if (block.type === 'paragraph') {
    return block.text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => new Paragraph({ children: textRunsFromMarkup(line) }));
  }

  if (block.type === 'list') {
    return block.items.map(
      (item) =>
        new Paragraph({
          numbering: { reference: block.ordered ? 'numbers' : 'bullets', level: 0 },
          children: textRunsFromMarkup(item),
        })
    );
  }

  if (block.type === 'table' && block.rows.length) {
    const colCount = Math.max(...block.rows.map((r) => r.length));
    const colWidth = Math.floor(CONTENT_WIDTH / colCount);
    const colWidths = Array(colCount).fill(colWidth);

    const rows = block.rows.map(
      (row, rowIndex) =>
        new TableRow({
          children: Array.from({ length: colCount }, (_, i) => {
            const cellText = row[i] || '';
            return new TableCell({
              borders: TABLE_BORDERS,
              width: { size: colWidth, type: WidthType.DXA },
              shading:
                rowIndex === 0
                  ? { fill: 'E8EEF4', type: ShadingType.CLEAR }
                  : undefined,
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: cellText, bold: rowIndex === 0 }),
                  ],
                }),
              ],
            });
          }),
        })
    );

    return [
      new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        columnWidths: colWidths,
        rows,
      }),
      new Paragraph({ text: '' }), // spacing after table
    ];
  }

  return [];
}

/**
 * Build a .docx Buffer from a block list (same shape produced by the docx parser).
 * @param {Array} blocks
 * @param {string} [title] - optional document title used for metadata only
 */
async function buildDocx(blocks, title) {
  const children = blocks.flatMap((b) => blockToDocxElements(b));

  const doc = new Document({
    title: title || 'Document',
    styles: {
      default: { document: { run: { font: 'Arial', size: 22 } } }, // 11pt body
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 36, bold: true, font: 'Arial', color: '1A1A2E' },
          paragraph: { spacing: { before: 280, after: 200 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 30, bold: true, font: 'Arial', color: '1A1A2E' },
          paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 26, bold: true, font: 'Arial', color: '333333' },
          paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '\u2022',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
        {
          reference: 'numbers',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: PAGE.margin } },
        children: children.length ? children : [new Paragraph({ text: '' })],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildDocx };
