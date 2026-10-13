// Nightly sweep for memorials that were orphaned by a GDPR account deletion
// and whose 30-day grace window has expired.
//
// A memorial lands in this queue when its owner deleted their account with
// no successor and no co-manager to promote (see /api/account/delete). We
// stamp `pendingDeletionAt = now + 30 days` and leave it offline so a
// super admin can restore it inside the window. Once the window closes,
// this sweep hard-deletes the memorial, its contributions, and any R2
// photos/audio associated with either.
//
// Protected by `x-cron-secret` matching `CRON_SECRET`. Wire it to any cron
// service — the paired Netlify scheduled function at
// `netlify/functions/orphan-sweep.mts` is the default.

import { NextRequest, NextResponse } from 'next/server';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { adminDb } from '@/lib/firebase-admin';
import { R2_BUCKET, r2Client } from '@/lib/r2';
import { writeAuditAdmin } from '@/lib/audit-admin';

export const runtime = 'nodejs';
// Scanning hundreds of memorials + their contributions + R2 deletes may
// take longer than the default serverless timeout. Netlify functions
// default to 10s but allow override via function config; this file sits
// behind the Next.js runtime so we rely on Netlify's background-function
// path (invoked via the scheduled function below).
export const maxDuration = 300;

const MAX_MEMORIALS_PER_RUN = 50;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 503 },
    );
  }
  const supplied = req.headers.get('x-cron-secret');
  if (!supplied || supplied !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = adminDb();
  const now = new Date();

  const dueSnap = await db
    .collection('memorials')
    .where('pendingDeletionAt', '<=', now)
    .limit(MAX_MEMORIALS_PER_RUN)
    .get();

  if (dueSnap.empty) {
    return NextResponse.json({ ok: true, swept: 0 });
  }

  let swept = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (const docSnap of dueSnap.docs) {
    const memorialId = docSnap.id;
    const m = docSnap.data() as {
      fullName?: string;
      heroPhotoPath?: string;
      pendingDeletionReason?: string;
    };

    try {
      const r2Keys = new Set<string>();
      if (m.heroPhotoPath) r2Keys.add(m.heroPhotoPath);

      // Pull every contribution for this memorial, collect their media keys,
      // then delete the docs. Use a stream over multiple paginated queries
      // in case there are more contributions than fit in a single page.
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
          const data = c.data() as {
            photoPath?: string;
            audioPath?: string;
          };
          if (data.photoPath) r2Keys.add(data.photoPath);
          if (data.audioPath) r2Keys.add(data.audioPath);
          contribDocsForDeletion.push(c);
        }
        if (page.size < 300) break;
        cursor = page.docs[page.docs.length - 1];
      }

      // Batch-delete R2 objects. S3 DeleteObjects caps at 1000 keys per call.
      const keys = Array.from(r2Keys);
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
          // R2 failure shouldn't abort the whole sweep; log and continue so
          // the Firestore docs still go away. Orphan object storage is a
          // smaller problem than a stuck memorial sitting past its grace
          // window.
          console.error('orphan-sweep: r2 delete failed', { memorialId, r2Err });
        }
      }

      // Delete contributions in batches of 400 (Firestore batch cap is 500,
      // keep headroom for other mutations below).
      for (let i = 0; i < contribDocsForDeletion.length; i += 400) {
        const batch = db.batch();
        for (const c of contribDocsForDeletion.slice(i, i + 400)) {
          batch.delete(c.ref);
        }
        await batch.commit();
      }

      await docSnap.ref.delete();

      await writeAuditAdmin({
        entityType: 'memorial',
        entityId: memorialId,
        action: 'orphan_swept',
        actorUid: 'system',
        details: {
          fullName: m.fullName || null,
          reason: m.pendingDeletionReason || 'orphan',
          contributions: contribDocsForDeletion.length,
          r2Keys: keys.length,
        },
      });

      swept++;
    } catch (err: any) {
      console.error('orphan-sweep: memorial failed', { memorialId, err });
      failures.push({ id: memorialId, error: err?.message || String(err) });
    }
  }

  return NextResponse.json({
    ok: true,
    swept,
    failures: failures.length,
    details: failures,
  });
}
