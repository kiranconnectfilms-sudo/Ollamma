'use strict';

const mammoth = require('mammoth');

/**
 * Parse a .docx buffer into a structured content model:
 * { blocks: [ {type, level, text, items, rows} ... ] }
 *
 * We use mammoth's HTML conversion because it gives us heading levels,
 * lists, and tables without hand-rolling OOXML parsing.
 */
async function parseDocx(buffer) {
  const { value: html, messages } = await mammoth.convertToHtml(
    { buffer },
    { styleMap: ['p[style-name="Title"] => h1.title'] }
  );

  const blocks = htmlToBlocks(html);
  return { blocks, warnings: messages.map((m) => m.message) };
}

function htmlToBlocks(html) {
  const blocks = [];
  // Very small tag-walker: mammoth output is clean, predictable HTML
  // (p, h1-h6, ul/ol/li, table/tr/td, strong, em) so a regex-based
  // block splitter is reliable here without pulling in a DOM lib.
  const blockRegex = /<(h[1-6]|p|ul|ol|table)[^>]*>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = blockRegex.exec(html)) !== null) {
    const [, tag, inner] = match;
    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ type: 'heading', level: Number(tag[1]), text: stripTags(inner) });
    } else if (tag === 'p') {
      const text = stripTags(inner);
      if (text.trim()) blocks.push({ type: 'paragraph', text });
    } else if (tag === 'ul' || tag === 'ol') {
      const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) =>
        stripTags(m[1])
      );
      blocks.push({ type: 'list', ordered: tag === 'ol', items });
    } else if (tag === 'table') {
      const rows = [...inner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((rowMatch) =>
        [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => stripTags(c[1]))
      );
      blocks.push({ type: 'table', rows });
    }
  }
  return blocks;
}

function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(strong|b|em|i|u|span|a)[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

module.exports = { parseDocx };
