'use strict';

const { askLocalModelForJson } = require('./ollama');

// Rough safety cap: very large documents risk truncated/invalid JSON coming back
// and cost a lot per request. Surface a clear error rather than silently failing.
const MAX_CONTENT_CHARS = 60000;

function assertWithinSize(contentJson) {
  const size = JSON.stringify(contentJson).length;
  if (size > MAX_CONTENT_CHARS) {
    const err = new Error(
      `This file's content is too large to edit in one pass (${size.toLocaleString()} characters, limit ${MAX_CONTENT_CHARS.toLocaleString()}). Try a shorter document or split it into smaller files.`
    );
    err.code = 'CONTENT_TOO_LARGE';
    throw err;
  }
}

const DOCUMENT_SYSTEM_PROMPT = `You are a professional editor. You receive a document represented as a JSON array of content blocks (type: "heading" | "paragraph" | "list" | "table") and you return an improved version in the EXACT SAME JSON shape.

Rules:
- Preserve every fact, number, name, and data point exactly. Never invent, remove, or alter factual content.
- Improve clarity, grammar, flow, and structure. Tighten wordy sentences. Fix typos.
- You may merge, split, or reorder blocks if it improves structure, but do not lose information.
- Keep heading levels sensible (1 = top-level, higher numbers = deeper nesting).
- For "list" blocks, keep "items" as an array of strings and preserve "ordered" (true/false).
- For "table" blocks, keep "rows" as an array of arrays of strings; first row is the header row. Do not change table data values unless explicitly asked to.
- Use **bold** markup sparingly to emphasize genuinely important terms, not whole sentences.
- Respond with ONLY a JSON object: {"blocks": [...]}. No prose, no markdown fences, no explanation.`;

const SPREADSHEET_SYSTEM_PROMPT = `You are a meticulous spreadsheet editor. You receive a workbook as JSON: {"sheets": [{"name": string, "rows": [[cell, ...], ...]}]} where the first row of each sheet is normally a header row. You return the corrected/improved workbook in the EXACT SAME JSON shape.

Rules:
- Never invent data values. Do not change numbers unless explicitly instructed to, or unless fixing an obvious typo/formatting inconsistency (e.g. "1,200" vs "1200" - keep numeric, consistent).
- You may clean up header names, fix inconsistent casing/spacing, remove fully blank rows, and align column meaning across rows.
- If asked to add analysis (totals, summary stats), add them as new rows or a new sheet clearly labeled, and only if explicitly requested - otherwise leave structure as-is.
- Keep every sheet that was present unless asked to remove one.
- Respond with ONLY a JSON object: {"sheets": [...]}. No prose, no markdown fences, no explanation.`;

const PRESENTATION_SYSTEM_PROMPT = `You are a presentation editor. You receive slides as JSON: {"slides": [{"title": string, "bullets": [string], "notes": string}]}. You return improved slides in the EXACT SAME JSON shape.

Rules:
- Preserve every fact, number, and data point. Never invent content.
- Tighten bullet text: each bullet should be a short, punchy phrase, not a paragraph (aim under 14 words).
- Improve titles to be clear and specific, not generic.
- You may reorder or merge bullets within a slide, and rebalance content if one slide is overloaded and another is thin, but do not change the number of slides unless asked.
- Keep speaker notes ("notes") as supporting detail/context for what the presenter would say, expand briefly if empty and content allows.
- Respond with ONLY a JSON object: {"slides": [...]}. No prose, no markdown fences, no explanation.`;

function buildUserPrompt(contentJson, customInstruction) {
  const instructionText = customInstruction && customInstruction.trim()
    ? `Additional instruction from the user (apply this on top of the standard polish pass): "${customInstruction.trim()}"`
    : 'No additional instruction was given - just do a standard professional polish pass.';

  return `${instructionText}\n\nContent JSON:\n${JSON.stringify(contentJson)}`;
}

async function editDocumentBlocks(blocks, customInstruction) {
  assertWithinSize({ blocks });
  const result = await askLocalModelForJson({
    system: DOCUMENT_SYSTEM_PROMPT,
    user: buildUserPrompt({ blocks }, customInstruction),
    maxTokens: 8000,
  });
  if (!Array.isArray(result.blocks)) throw new Error('AI response missing "blocks" array');
  return result.blocks;
}

async function editSpreadsheet(sheets, customInstruction) {
  assertWithinSize({ sheets });
  const result = await askLocalModelForJson({
    system: SPREADSHEET_SYSTEM_PROMPT,
    user: buildUserPrompt({ sheets }, customInstruction),
    maxTokens: 8000,
  });
  if (!Array.isArray(result.sheets)) throw new Error('AI response missing "sheets" array');
  return result.sheets;
}

async function editPresentation(slides, customInstruction) {
  assertWithinSize({ slides });
  const result = await askLocalModelForJson({
    system: PRESENTATION_SYSTEM_PROMPT,
    user: buildUserPrompt({ slides }, customInstruction),
    maxTokens: 8000,
  });
  if (!Array.isArray(result.slides)) throw new Error('AI response missing "slides" array');
  return result.slides;
}

module.exports = { editDocumentBlocks, editSpreadsheet, editPresentation };
