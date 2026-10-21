// SVG builders for cemetery artwork variants. Each takes a QR-SVG string and
// cemetery details, returns a complete SVG document ready to rasterise or
// download. Dependency-free so the same code can run on client or server.
//
// Variants:
//   - sticker (600x600)        — square sticker with QR + name + tagline
//   - poster (A4 portrait)     — large printable, 595x842 (A4 at 72dpi)
//   - card (business card)     — landscape 350x200 (~85x51mm at 72dpi)
//
// The plain QR itself isn't built here — callers already have the decorated
// QR SVG from `qrcode` + lib/qr. We embed it as a nested <svg>.

const TAGLINE_DEFAULT = 'Scan to visit everyone remembered here';

export type CemeteryArtworkVariant = 'sticker' | 'poster' | 'card';

export interface CemeteryArtworkInput {
  qrSvg: string; // decorated QR (margin: 0), full <svg> doc
  cemeteryName: string;
  address?: string;
  tagline?: string;
  markDataUrl?: string; // LiveOnWithMe mark as data URL (optional)
}

export interface CemeteryArtworkDims {
  w: number;
  h: number;
}

export function cemeteryArtworkDimensions(variant: CemeteryArtworkVariant): CemeteryArtworkDims {
  switch (variant) {
    case 'sticker':
      return { w: 600, h: 600 };
    case 'poster':
      return { w: 595, h: 842 };
    case 'card':
      return { w: 350, h: 200 };
  }
}

// Extract the raw inner nodes of a QR svg so we can scale/position it inside
// a nested <svg> container.
function qrInner(qrSvg: string): { viewBox: string; inner: string } {
  const vb = qrSvg.match(/viewBox="([^"]+)"/)?.[1] || '0 0 29 29';
  const inner = qrSvg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  return { viewBox: vb, inner };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Truncate so very long cemetery names don't overflow the layout. Keeps the
// visual size predictable without having to measure text at render time.
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

// Word-wrap into up to `maxLines` lines of roughly `maxCharsPerLine` characters.
// Falls back to character-splitting for words longer than the line budget so a
// single giant token can't push every subsequent line off-canvas.
function wrapText(s: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = s.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const raw of words) {
    const parts: string[] = [];
    let word = raw;
    while (word.length > maxCharsPerLine) {
      parts.push(word.slice(0, maxCharsPerLine));
      word = word.slice(maxCharsPerLine);
    }
    parts.push(word);
    for (const part of parts) {
      const candidate = line ? `${line} ${part}` : part;
      if (candidate.length > maxCharsPerLine && line) {
        lines.push(line);
        if (lines.length === maxLines) return lines;
        line = part;
      } else {
        line = candidate;
      }
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length > maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > maxCharsPerLine - 1
      ? `${last.slice(0, maxCharsPerLine - 1).trimEnd()}…`
      : `${last}…`;
    lines.length = maxLines;
  }
  return lines;
}

function multilineTspans(x: number, lineHeight: number, lines: string[]): string {
  return lines
    .map(
      (ln, i) =>
        `<tspan x="${x}" ${i === 0 ? '' : `dy="${lineHeight}"`}>${escapeXml(ln)}</tspan>`,
    )
    .join('');
}

export function buildCemeteryStickerSvg(input: CemeteryArtworkInput): string {
  const { qrSvg, cemeteryName, tagline } = input;
  const name = clip(cemeteryName.trim(), 40);
  const line = clip((tagline || TAGLINE_DEFAULT).trim(), 46);
  const { viewBox: qrVb, inner: qrInnerNodes } = qrInner(qrSvg);
  const W = 600;
  const H = 600;
  const qrSize = 360;
  const qrX = (W - qrSize) / 2;
  const qrY = 110;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
      `<rect x="0" y="0" width="${W}" height="${H}" rx="48" ry="48" fill="#fffdf9"/>` +
      `<rect x="12" y="12" width="${W - 24}" height="${H - 24}" rx="38" ry="38" fill="none" stroke="#e8e1d7" stroke-width="2"/>` +
      `<text x="${W / 2}" y="72" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="30" fill="#25312d">${escapeXml(name)}</text>` +
      `<svg x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" viewBox="${qrVb}" preserveAspectRatio="xMidYMid meet">${qrInnerNodes}</svg>` +
      `<text x="${W / 2}" y="${qrY + qrSize + 48}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="18" fill="#6d7772">${escapeXml(line)}</text>` +
      `<text x="${W / 2}" y="${H - 36}" text-anchor="middle" font-family="Georgia, serif" font-size="18" font-style="italic" fill="#688076">liveonwith.me</text>` +
    `</svg>`
  );
}

export function buildCemeteryPosterSvg(input: CemeteryArtworkInput): string {
  const { qrSvg, cemeteryName, address, tagline, markDataUrl } = input;
  const name = clip(cemeteryName.trim(), 44);
  const addrLines = address ? wrapText(address.trim(), 46, 5) : [];
  const line = clip((tagline || TAGLINE_DEFAULT).trim(), 56);
  const { viewBox: qrVb, inner: qrInnerNodes } = qrInner(qrSvg);
  const W = 595;
  const H = 842;
  // Everything below the address flows from `qrY`, which tracks how many
  // address lines we actually render — so a 5-line address stays legible
  // without overlapping the QR, tagline, or footer logo.
  const addrFirstY = 195;
  const addrLineHeight = 17;
  const addrShift = Math.max(0, addrLines.length - 1) * addrLineHeight;
  const qrYMin = 240;
  const qrY = Math.max(qrYMin, addrFirstY + addrShift + 25);
  // Phone-text baseline must sit above the footer mark/logo band (H - 96).
  const phoneGapBelowQr = 95;
  const footerTopY = H - 96;
  const maxQrSize = footerTopY - 15 - phoneGapBelowQr - qrY;
  const qrSize = Math.max(260, Math.min(380, maxQrSize));
  const qrX = (W - qrSize) / 2;
  const addrSvg = addrLines.length
    ? `<text x="${W / 2}" y="${addrFirstY}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="15" fill="#6d7772">${multilineTspans(W / 2, addrLineHeight, addrLines)}</text>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
      `<rect x="0" y="0" width="${W}" height="${H}" fill="#fffdf9"/>` +
      `<rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="18" ry="18" fill="none" stroke="#e8e1d7" stroke-width="2"/>` +
      `<text x="${W / 2}" y="110" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="12" letter-spacing="4" fill="#688076">RESTING HERE</text>` +
      `<text x="${W / 2}" y="160" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="38" fill="#25312d">${escapeXml(name)}</text>` +
      addrSvg +
      `<svg x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" viewBox="${qrVb}" preserveAspectRatio="xMidYMid meet">${qrInnerNodes}</svg>` +
      `<text x="${W / 2}" y="${qrY + qrSize + 60}" text-anchor="middle" font-family="Georgia, serif" font-size="22" font-style="italic" fill="#25312d">${escapeXml(line)}</text>` +
      `<text x="${W / 2}" y="${qrY + qrSize + 95}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="13" fill="#6d7772">Point your phone camera at the code</text>` +
      (markDataUrl
        ? `<image href="${markDataUrl}" x="${W / 2 - 24}" y="${H - 96}" width="48" height="48" preserveAspectRatio="xMidYMid meet"/>` +
          `<text x="${W / 2}" y="${H - 36}" text-anchor="middle" font-family="Georgia, serif" font-size="14" font-style="italic" fill="#688076">liveonwith.me</text>`
        : `<text x="${W / 2}" y="${H - 48}" text-anchor="middle" font-family="Georgia, serif" font-size="16" font-style="italic" fill="#688076">liveonwith.me</text>`) +
    `</svg>`
  );
}

export function buildCemeteryCardSvg(input: CemeteryArtworkInput): string {
  const { qrSvg, cemeteryName, tagline } = input;
  const { viewBox: qrVb, inner: qrInnerNodes } = qrInner(qrSvg);
  const W = 350;
  const H = 200;
  const qrSize = 160;
  const qrX = 20;
  const qrY = (H - qrSize) / 2;
  const textX = qrX + qrSize + 20;
  // Text column is ~138px wide, so pick char-per-line budgets that keep
  // Georgia 18pt (name) and Inter 11pt (tagline) within the card border.
  const nameLines = wrapText(cemeteryName.trim(), 14, 3);
  const taglineLines = wrapText((tagline || TAGLINE_DEFAULT).trim(), 26, 3);
  const eyebrowY = 34;
  const nameFirstY = eyebrowY + 24;
  const nameLineHeight = 21;
  const nameLastY = nameFirstY + (nameLines.length - 1) * nameLineHeight;
  const taglineFirstY = nameLastY + 20;
  const taglineLineHeight = 13;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
      `<rect x="0" y="0" width="${W}" height="${H}" rx="12" ry="12" fill="#fffdf9"/>` +
      `<rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="8" ry="8" fill="none" stroke="#e8e1d7" stroke-width="1.5"/>` +
      `<svg x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" viewBox="${qrVb}" preserveAspectRatio="xMidYMid meet">${qrInnerNodes}</svg>` +
      `<text x="${textX}" y="${eyebrowY}" font-family="Georgia, 'Times New Roman', serif" font-size="10" letter-spacing="2" fill="#688076">RESTING HERE</text>` +
      `<text x="${textX}" y="${nameFirstY}" font-family="Georgia, 'Times New Roman', serif" font-size="18" fill="#25312d">${multilineTspans(textX, nameLineHeight, nameLines)}</text>` +
      `<text x="${textX}" y="${taglineFirstY}" font-family="Inter, system-ui, sans-serif" font-size="11" fill="#6d7772">${multilineTspans(textX, taglineLineHeight, taglineLines)}</text>` +
      `<text x="${textX}" y="${H - 18}" font-family="Georgia, serif" font-size="12" font-style="italic" fill="#688076">liveonwith.me</text>` +
    `</svg>`
  );
}
