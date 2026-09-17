const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;
const SKIP_UNDER_BYTES = 200 * 1024;
const KEEP_UNDER_BYTES = 800 * 1024;

export async function resizeForMobile(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.size < SKIP_UNDER_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = bitmap;
    const longSide = Math.max(width, height);

    if (longSide <= MAX_DIMENSION && file.size < KEEP_UNDER_BYTES) {
      bitmap.close?.();
      return file;
    }

    const scale = Math.min(1, MAX_DIMENSION / longSide);
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() });
  } catch (err) {
    console.warn('Image resize failed, uploading original:', err);
    return file;
  }
}
