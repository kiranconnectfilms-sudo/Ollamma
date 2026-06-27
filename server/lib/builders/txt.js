'use strict';

/** Parse plain text into paragraph blocks, splitting on blank lines. */
function parseTxt(text) {
  const blocks = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text) => ({ type: 'paragraph', text }));
  return { blocks };
}

/** Rebuild plain text from paragraph blocks. */
function buildTxt(blocks) {
  return blocks
    .map((b) => {
      if (b.type === 'heading') return `${b.text}\n${'='.repeat(Math.min(b.text.length, 60))}`;
      if (b.type === 'list') return b.items.map((i) => `- ${i}`).join('\n');
      if (b.type === 'table') return b.rows.map((r) => r.join('\t')).join('\n');
      return b.text;
    })
    .join('\n\n');
}

module.exports = { parseTxt, buildTxt };
