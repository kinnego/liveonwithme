// Client-side helpers for rendering uploaded photos with responsive variants.
// Variants are generated server-side by lib/image-variants.ts; records carry a
// `photoVariants: true` flag when the `.400.webp` and `.800.webp` siblings
// exist. Records without the flag (older uploads, non-image types, failed
// variant jobs) fall back to the original URL as before.

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';

export function photoOriginalUrl(path: string): string {
  return `${R2_PUBLIC_URL}/${path}`;
}

export function photoSrc(path: string, variants?: boolean, prefer: 400 | 800 = 800): string {
  if (!variants) return photoOriginalUrl(path);
  return `${R2_PUBLIC_URL}/${path}.${prefer}.webp`;
}

export function photoSrcSet(path: string, variants?: boolean): string | undefined {
  if (!variants) return undefined;
  const base = `${R2_PUBLIC_URL}/${path}`;
  return `${base}.400.webp 400w, ${base}.800.webp 800w, ${base} 1600w`;
}
