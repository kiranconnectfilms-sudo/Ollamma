'use strict';

const ExcelJS = require('exceljs');

/**
 * Parse an .xlsx (or .csv) buffer into a structured workbook model:
 * { sheets: [ { name, rows: [ [cellValue, ...], ... ] } ] }
 *
 * Values are coerced to strings/numbers only (formulas resolved to their
 * cached result where available) - this keeps the AI prompt simple and JSON-safe.
 */
async function parseXlsx(buffer, isCsv = false) {
  const workbook = new ExcelJS.Workbook();
  if (isCsv) {
    await workbook.csv.read(bufferToStream(buffer));
  } else {
    await workbook.xlsx.load(buffer);
  }

  const sheets = workbook.worksheets.map((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        values.push(cellToValue(cell));
      });
      rows.push(values);
    });
    return { name: ws.name, rows: trimTrailingEmptyRows(rows) };
  });

  return { sheets };
}

function cellToValue(cell) {
  if (cell.value === null || cell.value === undefined) return '';
  if (typeof cell.value === 'object') {
    if ('result' in cell.value) return cell.value.result ?? '';
    if ('richText' in cell.value) return cell.value.richText.map((t) => t.text).join('');
    if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10);
    return String(cell.value);
  }
  return cell.value;
}

function trimTrailingEmptyRows(rows) {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((v) => v === '' || v === null || v === undefined)) {
    end--;
  }
  return rows.slice(0, end);
}

function bufferToStream(buffer) {
  const { Readable } = require('stream');
  return Readable.from(buffer);
}

module.exports = { parseXlsx };
