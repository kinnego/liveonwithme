// Shared plaque SVG builder — used client-side for the live preview and
// download. Kept pure and dependency-free so it can be reused server-side if
// we ever need to render the same artwork there.

import type { PlaqueShape, PlaqueOrientation } from './types';

export const DEFAULT_PLAQUE_SHAPE: PlaqueShape = 'oval';
export const DEFAULT_PLAQUE_ORIENTATION: PlaqueOrientation = 'portrait';
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

// When qrOnly is on, the top mark is suppressed and the QR grows to fill the
// space the mark used to occupy. Bottom text position stays put so a plaque
// toggled between modes doesn't shift the engraved line underfoot.
function applyQrOnly(
  l: PlaqueLayout,
  shape: PlaqueShape,
  orientation: PlaqueOrientation,
): PlaqueLayout {
  let qrSize: number;
  let qrY: number;
  if (shape === 'oval' && orientation === 'landscape') {
    qrSize = 220;
    qrY = l.h / 2 - qrSize / 2 - 20; // bias up a touch to clear the bottom text
  } else if (shape === 'oval') {
    qrSize = 300;
    qrY = 130;
  } else if (shape === 'round') {
    qrSize = 320;
    qrY = 90;
  } else {
    // square
    qrSize = 360;
    qrY = 60;
  }
  return {
    ...l,
    markSize: 0,
    markX: 0,
    markY: 0,
    qrSize,
    qrX: l.w / 2 - qrSize / 2,
    qrY,
  };
}

function layoutFor(
  shape: PlaqueShape,
  showBorder: boolean,
  orientation: PlaqueOrientation = DEFAULT_PLAQUE_ORIENTATION,
  qrOnly: boolean = false,
): PlaqueLayout {
  const strokeAttr = showBorder ? 'stroke="#000000" stroke-width="3"' : 'stroke="none"';
  let base: PlaqueLayout;
  if (shape === 'round') {
    const w = 500;
    const h = 500;
    base = {
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
  } else if (shape === 'square') {
    const w = 500;
    const h = 500;
    base = {
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
  } else if (shape === 'oval' && orientation === 'landscape') {
    // Landscape oval — mark on the left, QR on the right, text under both.
    // 3:2 ratio so the content doesn't look cramped at either end. Mark
    // (140 wide) and QR (200 wide) sit either side of a 70-px gap. The
    // QR is visually heavier than the mark, so we shift the whole block
    // left of mathematical centre so the apparent centre of mass lands
    // on the ellipse axis.
    const w = 600;
    const h = 400;
    const markSize = 140;
    const qrSize = 200;
    const gap = 70;
    const contentWidth = markSize + gap + qrSize; // 410
    const startX = (w - contentWidth) / 2 - 15; // 80 — nudged left to visually balance the heavier QR
    const centerY = h / 2 - 10; // 190 — a touch below the original top-weighted layout
    base = {
      w,
      h,
      shapeSvg: `<ellipse cx="${w / 2}" cy="${h / 2}" rx="290" ry="190" fill="#ffffff" ${strokeAttr}/>`,
      markSize,
      markX: startX,
      markY: centerY - markSize / 2,
      qrSize,
      qrX: startX + markSize + gap,
      qrY: centerY - qrSize / 2,
      textX: w / 2,
      textY: 350,
      textSize: 17,
    };
  } else {
    // oval portrait (default) — 2:3
    const w = 400;
    const h = 600;
    base = {
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
  return qrOnly ? applyQrOnly(base, shape, orientation) : base;
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
  markDataUrl: string;   // data:image/… URL for the mark image (ignored when qrOnly)
  bottomText?: string | null;
  showBorder?: boolean;  // defaults to true
  orientation?: PlaqueOrientation; // only affects oval; defaults to 'portrait'
  qrOnly?: boolean;      // when true, suppress the top mark and let the QR take its place
}

export function buildPlaqueSvg(input: PlaqueRenderInput): string {
  const showBorder = input.showBorder !== false;
  const orientation = input.orientation ?? DEFAULT_PLAQUE_ORIENTATION;
  const qrOnly = input.qrOnly === true;
  const layout = layoutFor(input.shape, showBorder, orientation, qrOnly);
  const { viewBox, inner } = extractQrParts(input.qrSvg);
  const text = (input.bottomText || '').trim().slice(0, MAX_BOTTOM_TEXT_LEN);
  const textEl = text
    ? `<text x="${layout.textX}" y="${layout.textY}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${layout.textSize}" fill="#000000" letter-spacing="1">${escapeXml(text)}</text>`
    : '';
  const markEl = qrOnly
    ? ''
    : `<image href="${input.markDataUrl}" x="${layout.markX}" y="${layout.markY}" width="${layout.markSize}" height="${layout.markSize}" preserveAspectRatio="xMidYMid meet"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.w} ${layout.h}" width="${layout.w}" height="${layout.h}">
  <rect width="${layout.w}" height="${layout.h}" fill="#ffffff"/>
  ${layout.shapeSvg}
  ${markEl}
  <svg x="${layout.qrX}" y="${layout.qrY}" width="${layout.qrSize}" height="${layout.qrSize}" viewBox="${viewBox}">${inner}</svg>
  ${textEl}
</svg>`;
}

export function plaqueDimensions(
  shape: PlaqueShape,
  orientation: PlaqueOrientation = DEFAULT_PLAQUE_ORIENTATION,
): { w: number; h: number } {
  const l = layoutFor(shape, true, orientation);
  return { w: l.w, h: l.h };
}
