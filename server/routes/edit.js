'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const { detectType, LEGACY_UNSUPPORTED } = require('../lib/fileTypes');
const { parseDocx } = require('../lib/parsers/docx');
const { parseXlsx } = require('../lib/parsers/xlsx');
const { parseCsv, rowsToCsv } = require('../lib/parsers/csv');
const { parsePptx } = require('../lib/parsers/pptx');
const { parsePdf } = require('../lib/parsers/pdf');
const { parseTxt, buildTxt } = require('../lib/builders/txt');

const { buildDocx } = require('../lib/builders/docx');
const { buildXlsx } = require('../lib/builders/xlsx');
const { buildPptx } = require('../lib/builders/pptx');
const { buildPdf } = require('../lib/builders/pdf');

const { editDocumentBlocks, editSpreadsheet, editPresentation } = require('../lib/aiEdit');
const { OllamaConfigError, OllamaApiError } = require('../lib/ollama');
const access = require('../lib/access');

const router = express.Router();

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 25);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

// In-memory job store. No accounts, no persistence beyond process lifetime -
// jobs are addressed by a random id and cleaned up after download or timeout.
const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

function createJob(data) {
  const id = crypto.randomUUID();
  jobs.set(id, { ...data, createdAt: Date.now() });
  setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref?.();
  return id;
}

function cleanFilename(name) {
  const base = path.basename(name, path.extname(name));
  return base.replace(/[^a-z0-9_\- ]/gi, '_').slice(0, 80) || 'document';
}

/**
 * POST /api/edit
 * multipart/form-data: file=<the upload>, instruction=<optional custom instruction>
 * Returns { jobId, type, originalName } - actual file content is fetched via /api/download/:jobId
 */
router.post('/edit', upload.single('file'), async (req, res) => {
  // Access gate: every upload requires a one-time code obtained via the
  // /request-access → admin approval → email flow. We validate here so
  // unauthorized requests are rejected before any work; the code is
  // actually consumed later, just before the AI call, so client-side
  // errors (wrong file type, oversize) don't burn the user's code.
  const submittedCode = req.body?.accessCode || req.headers['x-access-code'];
  const validation = access.validateCode(submittedCode);
  if (!validation.ok) {
    return res.status(401).json({ error: validation.error });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file was uploaded.' });
  }

  const { originalname, buffer } = req.file;
  const instruction = (req.body.instruction || '').slice(0, 2000);
  const { ext, info } = detectType(originalname);

  if (!info) {
    return res.status(400).json({
      error: `Unsupported file type ".${ext}". Supported: Word (.docx), Excel (.xlsx, .csv), PowerPoint (.pptx), PDF (.pdf), Text (.txt).`,
    });
  }

  if (LEGACY_UNSUPPORTED.has(ext)) {
    return res.status(400).json({
      error: `Legacy ".${ext}" files use an old binary format that this app can't read directly. Please re-save the file as ${ext === 'doc' ? '.docx' : ext === 'xls' ? '.xlsx' : '.pptx'} in Word/Excel/PowerPoint (or Google Docs/Sheets/Slides via "File > Download") and upload that instead.`,
    });
  }

  try {
    const baseName = cleanFilename(originalname);

    // Idempotent helper: actually marks the access code as spent. Called
    // after parsing succeeds (so a malformed file doesn't waste the code)
    // but before the AI call (which is the expensive part). Wrapped so each
    // branch can call it at the right moment without duplicating logic.
    let codeConsumed = false;
    const commitCode = () => {
      if (codeConsumed) return;
      const result = access.consumeCode(validation.code);
      if (!result.ok) {
        const err = new Error(result.error);
        err.code = 'CODE_ALREADY_SPENT';
        throw err;
      }
      codeConsumed = true;
    };

    if (info.kind === 'document') {
      const { blocks } = await parseDocx(buffer);
      commitCode();
      const editedBlocks = await editDocumentBlocks(blocks, instruction);
      const outBuffer = await buildDocx(editedBlocks, baseName);
      const jobId = createJob({ kind: 'document', buffer: outBuffer, filename: `${baseName}-edited.docx`, mime: info.mime });
      return res.json({ jobId, filename: `${baseName}-edited.docx`, kind: info.kind, blockCount: editedBlocks.length });
    }

    if (info.kind === 'spreadsheet') {
      const { sheets } = await parseXlsx(buffer, false);
      commitCode();
      const editedSheets = await editSpreadsheet(sheets, instruction);
      const outBuffer = await buildXlsx(editedSheets);
      const jobId = createJob({ kind: 'spreadsheet', buffer: outBuffer, filename: `${baseName}-edited.xlsx`, mime: info.mime });
      return res.json({ jobId, filename: `${baseName}-edited.xlsx`, kind: info.kind, sheetCount: editedSheets.length });
    }

    if (info.kind === 'csv') {
      const text = buffer.toString('utf-8');
      const rows = parseCsv(text);
      commitCode();
      const editedSheets = await editSpreadsheet([{ name: 'Sheet1', rows }], instruction);
      const outRows = editedSheets[0]?.rows || rows;
      const outBuffer = Buffer.from(rowsToCsv(outRows), 'utf-8');
      const jobId = createJob({ kind: 'csv', buffer: outBuffer, filename: `${baseName}-edited.csv`, mime: info.mime });
      return res.json({ jobId, filename: `${baseName}-edited.csv`, kind: info.kind, rowCount: outRows.length });
    }

    if (info.kind === 'presentation') {
      const { slides } = await parsePptx(buffer);
      commitCode();
      const editedSlides = await editPresentation(slides, instruction);
      const outBuffer = await buildPptx(editedSlides);
      const jobId = createJob({ kind: 'presentation', buffer: outBuffer, filename: `${baseName}-edited.pptx`, mime: info.mime });
      return res.json({ jobId, filename: `${baseName}-edited.pptx`, kind: info.kind, slideCount: editedSlides.length });
    }

    if (info.kind === 'pdf') {
      const { blocks } = await parsePdf(buffer);
      commitCode();
      const editedBlocks = await editDocumentBlocks(blocks, instruction);
      const outBuffer = await buildPdf(editedBlocks, baseName);
      const jobId = createJob({ kind: 'pdf', buffer: outBuffer, filename: `${baseName}-edited.pdf`, mime: info.mime });
      return res.json({ jobId, filename: `${baseName}-edited.pdf`, kind: info.kind, blockCount: editedBlocks.length });
    }

    if (info.kind === 'text') {
      const text = buffer.toString('utf-8');
      const { blocks } = parseTxt(text);
      commitCode();
      const editedBlocks = await editDocumentBlocks(blocks, instruction);
      const outBuffer = Buffer.from(buildTxt(editedBlocks), 'utf-8');
      const jobId = createJob({ kind: 'text', buffer: outBuffer, filename: `${baseName}-edited.txt`, mime: info.mime });
      return res.json({ jobId, filename: `${baseName}-edited.txt`, kind: info.kind, blockCount: editedBlocks.length });
    }

    return res.status(400).json({ error: 'Unhandled file kind.' });
  } catch (err) {
    return res.status(mapErrorStatus(err)).json({ error: describeError(err) });
  }
});

router.get('/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'This file is no longer available. Please re-upload and try again.' });
  }
  res.setHeader('Content-Type', job.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
  res.send(job.buffer);
  jobs.delete(req.params.jobId); // one-time download, nothing lingers
});

function mapErrorStatus(err) {
  if (err instanceof OllamaConfigError) return 503;
  if (err instanceof OllamaApiError) return 502;
  if (err.code === 'CONTENT_TOO_LARGE') return 413;
  if (err.code === 'CODE_ALREADY_SPENT') return 401;
  return 500;
}

function describeError(err) {
  if (err instanceof OllamaConfigError) return err.message;
  if (err instanceof OllamaApiError) return `The local AI model couldn't process this request: ${err.body || err.message}`;
  if (err.code === 'CONTENT_TOO_LARGE') return err.message;
  if (err.code === 'CODE_ALREADY_SPENT') return err.message;
  return `Something went wrong while processing this file: ${err.message}`;
}

module.exports = router;
