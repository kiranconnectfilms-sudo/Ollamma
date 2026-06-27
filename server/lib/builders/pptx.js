'use strict';

const PptxGenJS = require('pptxgenjs');

const COLORS = {
  bg: 'FFFFFF',
  title: '1A1A2E',
  body: '333333',
  accent: '3B6FE0',
  accentBar: '1A1A2E',
};

/**
 * Build a .pptx Buffer from a slides model: { slides: [{ title, bullets, notes }] }
 */
async function buildPptx(slides) {
  const pres = new PptxGenJS();
  pres.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pres.layout = 'WIDE';

  for (const slide of slides) {
    const s = pres.addSlide();
    s.background = { color: COLORS.bg };

    // Accent bar for visual structure
    s.addShape('rect', { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: COLORS.accentBar } });

    s.addText(slide.title || '', {
      x: 0.6,
      y: 0.45,
      w: 12.1,
      h: 0.9,
      fontFace: 'Arial',
      fontSize: 28,
      bold: true,
      color: COLORS.title,
    });

    if (slide.bullets && slide.bullets.length) {
      s.addText(
        slide.bullets.map((text) => ({
          text,
          options: { bullet: { code: '2022' }, breakLine: true },
        })),
        {
          x: 0.6,
          y: 1.5,
          w: 12.1,
          h: 5.4,
          fontFace: 'Arial',
          fontSize: 18,
          color: COLORS.body,
          valign: 'top',
          lineSpacingMultiple: 1.3,
        }
      );
    }

    if (slide.notes) {
      s.addNotes(slide.notes);
    }
  }

  if (!slides.length) {
    pres.addSlide();
  }

  return pres.write({ outputType: 'nodebuffer' });
}

module.exports = { buildPptx };
