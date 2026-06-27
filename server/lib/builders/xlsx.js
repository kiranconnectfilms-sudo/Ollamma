'use strict';

const ExcelJS = require('exceljs');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const BORDER_THIN = { style: 'thin', color: { argb: 'FFD9D9D9' } };

/**
 * Build an .xlsx Buffer from a sheets model: { sheets: [{ name, rows }] }
 * First row of each sheet is treated as a header and styled accordingly.
 */
async function buildXlsx(sheets) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AI Document Editor';
  workbook.created = new Date();

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sanitizeSheetName(sheet.name) || 'Sheet1');
    const rows = sheet.rows || [];

    rows.forEach((row, rowIndex) => {
      const excelRow = ws.addRow(row.map(coerceCell));
      if (rowIndex === 0) {
        excelRow.eachCell((cell) => {
          cell.fill = HEADER_FILL;
          cell.font = HEADER_FONT;
          cell.alignment = { vertical: 'middle' };
        });
        excelRow.height = 22;
      }
      excelRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
      });
    });

    autoSizeColumns(ws, rows);
    if (rows.length) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: rows[0].length || 1 } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    }
  }

  return workbook.xlsx.writeBuffer();
}

function coerceCell(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const asNumber = Number(value);
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(asNumber) && /^-?[\d.,]+$/.test(value.trim())) {
    return asNumber;
  }
  return value;
}

function autoSizeColumns(ws, rows) {
  const colCount = Math.max(0, ...rows.map((r) => r.length));
  for (let c = 1; c <= colCount; c++) {
    let maxLen = 8;
    rows.forEach((row) => {
      const v = row[c - 1];
      if (v !== undefined && v !== null) maxLen = Math.max(maxLen, String(v).length);
    });
    ws.getColumn(c).width = Math.min(Math.max(maxLen + 2, 10), 45);
  }
}

function sanitizeSheetName(name) {
  if (!name) return '';
  return name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
}

module.exports = { buildXlsx };
