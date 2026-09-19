// Server-side media usage summariser. Sums sizeBytes across all contributions
// (approved and pending) plus the memorial's hero photo. Cheap for typical
// memorial sizes; if this ever becomes a hot path we can denormalise into a
// running counter document.

import { adminDb } from './firebase-admin';

export interface UsageSummary {
  totalBytes: number;
  photoCount: number;
  videoCount: number;
  audioCount: number;
}

export async function summariseMemorialUsage(memorialId: string): Promise<UsageSummary> {
  const db = adminDb();
  const [memSnap, contribSnap] = await Promise.all([
    db.collection('memorials').doc(memorialId).get(),
    db.collection('contributions').where('memorialId', '==', memorialId).get(),
  ]);

  let totalBytes = 0;
  let photoCount = 0;
  let videoCount = 0;
  let audioCount = 0;

  if (memSnap.exists) {
    const m = memSnap.data()!;
    if (typeof m.heroPhotoSize === 'number') totalBytes += m.heroPhotoSize;
  }

  contribSnap.forEach((d) => {
    const c = d.data();
    if (typeof c.sizeBytes === 'number') totalBytes += c.sizeBytes;
    if (c.mediaType === 'video') videoCount++;
    else if (c.mediaType === 'audio') audioCount++;
    else if (c.photoPath) photoCount++;
  });

  return { totalBytes, photoCount, videoCount, audioCount };
}
