// Hard-delete the full tree for an orphaned memorial: R2 objects (hero +
// every contribution's photo/audio), contribution docs, then the memorial
// doc itself, with an audit event at the end.
//
// Used by the admin "Orphans" page — super-admin manually triggers each
// deletion after reviewing the memorial. Replaces the earlier nightly cron
// so an irreversible operation always has a human in the loop.

import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { adminDb } from './firebase-admin';
import { R2_BUCKET, r2Client } from './r2';
import { writeAuditAdmin } from './audit-admin';

export interface OrphanRow {
  id: string;
  fullName: string;
  pendingDeletionAt: Date | null;
  pendingDeletionReason: string | null;
  heroPhotoPath: string | null;
  heroPhotoVariants: boolean;
}

export async function listOrphans(): Promise<OrphanRow[]> {
  const db = adminDb();
  const snap = await db
    .collection('memorials')
    .where('pendingDeletionAt', '!=', null)
    .get();

  const rows: OrphanRow[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as any;
    const ts = d.pendingDeletionAt?.toDate?.() ?? null;
    rows.push({
      id: doc.id,
      fullName: d.fullName || '(unnamed)',
      pendingDeletionAt: ts instanceof Date ? ts : null,
      pendingDeletionReason: d.pendingDeletionReason || null,
      heroPhotoPath: d.heroPhotoPath || null,
      heroPhotoVariants: d.heroPhotoVariants === true,
    });
  }

  // Oldest due first so the admin reviews the most-overdue memorials up top.
  rows.sort((a, b) => {
    const at = a.pendingDeletionAt?.getTime() ?? Infinity;
    const bt = b.pendingDeletionAt?.getTime() ?? Infinity;
    return at - bt;
  });
  return rows;
}

export async function deleteOrphanedMemorial(
  memorialId: string,
  actorUid: string,
  actorEmail?: string,
): Promise<{ contributions: number; r2Keys: number }> {
  const db = adminDb();
  const memRef = db.collection('memorials').doc(memorialId);
  const memSnap = await memRef.get();
  if (!memSnap.exists) {
    throw new Error('Memorial not found');
  }
  const m = memSnap.data() as {
    fullName?: string;
    heroPhotoPath?: string;
    pendingDeletionReason?: string;
  };

  const r2Keys = new Set<string>();
  if (m.heroPhotoPath) r2Keys.add(m.heroPhotoPath);

  // Paginate contributions in case there are more than fit in a single page.
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  const contribDocsForDeletion: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  while (true) {
    let q = db
      .collection('contributions')
      .where('memorialId', '==', memorialId)
      .orderBy('__name__')
      .limit(300);
    if (cursor) q = q.startAfter(cursor);
    const page = await q.get();
    if (page.empty) break;
    for (const c of page.docs) {
      const data = c.data() as { photoPath?: string; audioPath?: string };
      if (data.photoPath) r2Keys.add(data.photoPath);
      if (data.audioPath) r2Keys.add(data.audioPath);
      contribDocsForDeletion.push(c);
    }
    if (page.size < 300) break;
    cursor = page.docs[page.docs.length - 1];
  }

  // R2 DeleteObjects caps at 1000 per call. Variants (`.400.webp` / `.800.webp`)
  // sit alongside each original key, so we extend the delete list to catch
  // them too — otherwise a swept memorial would leave hundreds of orphaned
  // resized thumbnails in storage.
  const allR2Keys = new Set<string>();
  for (const key of r2Keys) {
    allR2Keys.add(key);
    allR2Keys.add(`${key}.400.webp`);
    allR2Keys.add(`${key}.800.webp`);
  }
  const keys = Array.from(allR2Keys);
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    if (batch.length === 0) continue;
    try {
      await r2Client.send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    } catch (r2Err) {
      // R2 failure shouldn't abort the deletion; log and continue so the
      // Firestore docs still go. Orphan object storage is a smaller problem
      // than a stuck memorial.
      console.error('orphan-delete: r2 delete failed', { memorialId, r2Err });
    }
  }

  // Firestore batch cap is 500; keep headroom.
  for (let i = 0; i < contribDocsForDeletion.length; i += 400) {
    const batch = db.batch();
    for (const c of contribDocsForDeletion.slice(i, i + 400)) {
      batch.delete(c.ref);
    }
    await batch.commit();
  }

  await memRef.delete();

  await writeAuditAdmin({
    entityType: 'memorial',
    entityId: memorialId,
    action: 'orphan_deleted',
    actorUid,
    actorEmail,
    details: {
      fullName: m.fullName || null,
      reason: m.pendingDeletionReason || 'orphan',
      contributions: contribDocsForDeletion.length,
      r2Keys: keys.length,
    },
  });

  return { contributions: contribDocsForDeletion.length, r2Keys: keys.length };
}
