'use strict';

const JSZip = require('jszip');

/**
 * Parse a .pptx buffer into a structured slide model:
 * { slides: [ { title, bullets: [string], notes: string } ] }
 *
 * PPTX is a zip of XML; we read each slideN.xml directly rather than
 * relying on a heavyweight OOXML object model, since we only need
 * text content (titles + body bullets) to feed the AI and rebuild slides.
 */
async function parsePptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const slides = [];
  for (const path of slideFiles) {
    const xml = await zip.files[path].async('string');
    const notesPath = path
      .replace('slides/', 'notesSlides/')
      .replace('slide', 'notesSlide');
    const notesXml = zip.files[notesPath]
      ? await zip.files[notesPath].async('string')
      : '';

    slides.push(extractSlideContent(xml, notesXml));
  }

  return { slides };
}

function slideNumber(path) {
  const m = path.match(/slide(\d+)\.xml$/);
  return m ? Number(m[1]) : 0;
}

function extractSlideContent(xml, notesXml) {
  // Each <p:sp> shape has text runs in <a:t>...</a:t> inside <a:p> paragraphs.
  // We don't rely on <p:ph type="title"/> placeholder markers because slides
  // built by this app's own pptx builder use plain text boxes, not
  // placeholder-typed shapes. Instead: the first shape carrying text is
  // treated as the title, every later text-bearing shape is a body bullet.
  // Pure decoration shapes (e.g. the accent bar, which has no <a:t> at all)
  // are naturally skipped since they contribute no paragraphs.
  const shapes = [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map((m) => m[1]);

  let title = '';
  const bullets = [];
  let titleAssigned = false;

  for (const shape of shapes) {
    const paragraphs = [...shape.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
      .map((p) => [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => decodeXml(t[1])).join(''))
      .filter((t) => t.trim());

    if (!paragraphs.length) continue;

    if (!titleAssigned) {
      title = paragraphs.join(' ');
      titleAssigned = true;
    } else {
      bullets.push(...paragraphs);
    }
  }

  // Notes: only read the actual notes body placeholder (type="body"),
  // never the slide-number field placeholder (type="sldNum"), which
  // contains a literal field value like "1" that isn't speaker-note text.
  const notesShapes = [...notesXml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map((m) => m[1]);
  let notes = '';
  for (const shape of notesShapes) {
    if (!/<p:ph[^>]*type="body"/.test(shape)) continue;
    notes = [...shape.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
      .map((m) => decodeXml(m[1]))
      .join(' ')
      .trim();
    break;
  }

  return { title: title || '', bullets, notes };
}

function decodeXml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

module.exports = { parsePptx };
