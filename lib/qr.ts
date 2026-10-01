// Shared QR embellishments. The `qrcode` package returns a plain SVG — we drop
// an image in its dead-centre (level-H error correction lets us knock out
// ~28% of the pattern without breaking scans). Photographs go through a
// mono + contrast filter so faces read against the surrounding black modules;
// brand marks render untreated as they're already clean two-tone artwork.

export type QrCenterImageShape = 'circle' | 'square';

export interface QrWithCenteredImageOptions {
  qrSvg: string;
  imageDataUrl: string;
  photoShape?: QrCenterImageShape;
  applyMonoFilter?: boolean;
  idPrefix?: string;
}

export function qrWithCenteredImage({
  qrSvg,
  imageDataUrl,
  photoShape = 'circle',
  applyMonoFilter = true,
  idPrefix = 'qrImg',
}: QrWithCenteredImageOptions): string {
  const vbMatch = qrSvg.match(/viewBox="([^"]+)"/);
  const vb = vbMatch ? vbMatch[1].split(/\s+/).map(Number) : [0, 0, 29, 29];
  const [vx, vy, vw, vh] = vb;
  const cx = vx + vw / 2;
  const cy = vy + vh / 2;
  const r = Math.min(vw, vh) * 0.14;
  const pad = r * 0.14;
  const suffix = Math.random().toString(36).slice(2, 8);
  const clipId = `${idPrefix}Clip-${suffix}`;
  const filterId = `${idPrefix}Mono-${suffix}`;
  const stroke = vw * 0.006;
  const backing =
    photoShape === 'square'
      ? `<rect x="${cx - r - pad}" y="${cy - r - pad}" width="${(r + pad) * 2}" height="${(r + pad) * 2}" fill="#ffffff"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${r + pad}" fill="#ffffff"/>`;
  const clipShape =
    photoShape === 'square'
      ? `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  const outline =
    photoShape === 'square'
      ? `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" fill="none" stroke="#000000" stroke-width="${stroke}"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#000000" stroke-width="${stroke}"/>`;
  const filterDef = applyMonoFilter
    ? `<filter id="${filterId}" color-interpolation-filters="sRGB">` +
        `<feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0"/>` +
        `<feComponentTransfer>` +
          `<feFuncR type="linear" slope="1.25" intercept="-0.12"/>` +
          `<feFuncG type="linear" slope="1.25" intercept="-0.12"/>` +
          `<feFuncB type="linear" slope="1.25" intercept="-0.12"/>` +
        `</feComponentTransfer>` +
      `</filter>`
    : '';
  // Logo variant: no clip, no outline — the mark sits flush as inline artwork.
  // Keep the white backing so surrounding QR modules don't bleed into the mark.
  const useOutline = applyMonoFilter;
  const useClip = applyMonoFilter;
  const imageAttrs = [
    `href="${imageDataUrl}"`,
    `x="${cx - r}"`,
    `y="${cy - r}"`,
    `width="${r * 2}"`,
    `height="${r * 2}"`,
    useClip ? `clip-path="url(#${clipId})"` : '',
    applyMonoFilter ? `filter="url(#${filterId})"` : '',
    `preserveAspectRatio="xMidYMid ${applyMonoFilter ? 'slice' : 'meet'}"`,
  ]
    .filter(Boolean)
    .join(' ');
  const overlay =
    `<defs>` +
      `<clipPath id="${clipId}">${clipShape}</clipPath>` +
      filterDef +
    `</defs>` +
    backing +
    `<image ${imageAttrs}/>` +
    (useOutline ? outline : '');
  return qrSvg.replace(/<\/svg>\s*$/, `${overlay}</svg>`);
}

// Fetches a same-origin URL (e.g. anything under /public) and returns it as a
// data URL. Keeps SVG filters working without having to configure CORS on the
// asset host — same-origin pixels are always sampleable.
export async function sameOriginUrlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
