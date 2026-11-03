// Generates smaller WebP variants of an uploaded image and writes them to R2
// as siblings of the original (same key with a `.{width}.webp` suffix). The
// originals are already client-resized to a 1600px long side, so the server
// only has to re-encode and down-scale — no need to defend against monster
// camera files here.
//
// Callers persist a `photoVariants: true` flag alongside the original path.
// At render time, clients check that flag and build an `<img srcset>` from
// `${path}.400.webp`, `${path}.800.webp`, plus the original (acting as the
// 1600w fallback). If variant generation fails for any reason we swallow
// the error — the upload still succeeds, the flag stays false, and the
// browser falls back to the original URL unchanged.

import { PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { r2Client, R2_BUCKET } from './r2';

export const VARIANT_WIDTHS = [400, 800] as const;

const VARIANT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function generateImageVariants(opts: {
  originalKey: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<boolean> {
  if (!VARIANT_MIME_TYPES.has(opts.mimeType)) return false;

  try {
    const probe = sharp(opts.buffer, { failOn: 'none' });
    const metadata = await probe.metadata();
    const sourceWidth = metadata.width ?? 0;
    if (sourceWidth < VARIANT_WIDTHS[0]) return false;

    await Promise.all(
      VARIANT_WIDTHS.map(async (width) => {
        const resized = await sharp(opts.buffer, { failOn: 'none' })
          .rotate() // apply EXIF orientation before resizing
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        await r2Client.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: `${opts.originalKey}.${width}.webp`,
            Body: resized,
            ContentType: 'image/webp',
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
      }),
    );
    return true;
  } catch (err) {
    console.error('image variant generation failed:', err);
    return false;
  }
}
