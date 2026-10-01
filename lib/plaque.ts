// Shared plaque SVG builder — used client-side for the live preview and
// download. Kept pure and dependency-free so it can be reused server-side if
// we ever need to render the same artwork there.

import type { PlaqueShape } from './types';

export const DEFAULT_PLAQUE_SHAPE: PlaqueShape = 'oval';
export const MAX_BOTTOM_TEXT_LEN = 32;

export interface PlaqueLayout {
  w: number;
  h: number;
  markX: number;
  markY: number;
  markSize: number;
  qrX: number;
  qrY: number;
  qrSize: number;
  textX: number;
  textY: number;
  textSize: number;
  shapeSvg: string; // the border element — ellipse / circle / rect
}

function layoutFor(shape: PlaqueShape, showBorder: boolean): PlaqueLayout {
  const strokeAttr = showBorder ? 'stroke="#000000" stroke-width="3"' : 'stroke="none"';
  if (shape === 'round') {
    const w = 500;
    const h = 500;
    return {
      w,
      h,
      shapeSvg: `<circle cx="${w / 2}" cy="${h / 2}" r="240" fill="#ffffff" ${strokeAttr}/>`,
      markSize: 90,
      markX: w / 2 - 45,
      markY: 70,
      qrSize: 220,
      qrX: w / 2 - 110,
      qrY: 175,
      textX: w / 2,
      textY: 425,
      textSize: 17,
    };
  }
  if (shape === 'square') {
    const w = 500;
    const h = 500;
    return {
      w,
      h,
      shapeSvg: `<rect x="20" y="20" width="460" height="460" rx="30" ry="30" fill="#ffffff" ${strokeAttr}/>`,
      markSize: 110,
      markX: w / 2 - 55,
      markY: 55,
      qrSize: 260,
      qrX: w / 2 - 130,
      qrY: 180,
      textX: w / 2,
      textY: 465,
      textSize: 18,
    };
  }
  // oval (default) — 2:3 portrait
  const w = 400;
  const h = 600;
  return {
    w,
    h,
    shapeSvg: `<ellipse cx="${w / 2}" cy="${h / 2}" rx="190" ry="290" fill="#ffffff" ${strokeAttr}/>`,
    markSize: 150,
    markX: w / 2 - 75,
    markY: 70,
    qrSize: 240,
    qrX: w / 2 - 120,
    qrY: 240,
    textX: w / 2,
    textY: 540,
    textSize: 18,
  };
}

// Takes the raw SVG string returned by the `qrcode` library and returns the
// inner markup plus its viewBox, ready to re-embed inside a nested <svg>.
function extractQrParts(qrSvg: string): { viewBox: string; inner: string } {
  const vbMatch = qrSvg.match(/viewBox="([^"]+)"/);
  const viewBox = vbMatch ? vbMatch[1] : '0 0 29 29';
  const inner = qrSvg
    .replace(/<\?xml[^?]*\?>/, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();
  return { viewBox, inner };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface PlaqueRenderInput {
  shape: PlaqueShape;
  qrSvg: string;         // raw <svg>…</svg> from the qrcode library
  markDataUrl: string;   // data:image/… URL for the mark image
  bottomText?: string | null;
  showBorder?: boolean;  // defaults to true
}

export function buildPlaqueSvg(input: PlaqueRenderInput): string {
  const showBorder = input.showBorder !== false;
  const layout = layoutFor(input.shape, showBorder);
  const { viewBox, inner } = extractQrParts(input.qrSvg);
  const text = (input.bottomText || '').trim().slice(0, MAX_BOTTOM_TEXT_LEN);
  const textEl = text
    ? `<text x="${layout.textX}" y="${layout.textY}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${layout.textSize}" fill="#000000" letter-spacing="1">${escapeXml(text)}</text>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.w} ${layout.h}" width="${layout.w}" height="${layout.h}">
  <rect width="${layout.w}" height="${layout.h}" fill="#ffffff"/>
  ${layout.shapeSvg}
  <image href="${input.markDataUrl}" x="${layout.markX}" y="${layout.markY}" width="${layout.markSize}" height="${layout.markSize}" preserveAspectRatio="xMidYMid meet"/>
  <svg x="${layout.qrX}" y="${layout.qrY}" width="${layout.qrSize}" height="${layout.qrSize}" viewBox="${viewBox}">${inner}</svg>
  ${textEl}
</svg>`;
}

export function plaqueDimensions(shape: PlaqueShape): { w: number; h: number } {
  const l = layoutFor(shape, true);
  return { w: l.w, h: l.h };
}
