'use strict';

const path = require('path');

const TYPES = {
  docx: { label: 'Word Document', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document' },
  doc: { label: 'Word Document (legacy)', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document' },
  xlsx: { label: 'Excel Spreadsheet', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'spreadsheet' },
  xls: { label: 'Excel Spreadsheet (legacy)', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'spreadsheet' },
  csv: { label: 'CSV File', ext: 'csv', mime: 'text/csv', kind: 'csv' },
  pptx: { label: 'PowerPoint Presentation', ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'presentation' },
  ppt: { label: 'PowerPoint Presentation (legacy)', ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'presentation' },
  pdf: { label: 'PDF Document', ext: 'pdf', mime: 'application/pdf', kind: 'pdf' },
  txt: { label: 'Text File', ext: 'txt', mime: 'text/plain', kind: 'text' },
};

const LEGACY_UNSUPPORTED = new Set(['doc', 'xls', 'ppt']);

function detectType(filename) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  return { ext, info: TYPES[ext] || null };
}

module.exports = { TYPES, LEGACY_UNSUPPORTED, detectType };
