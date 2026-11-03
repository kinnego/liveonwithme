// Super-admin backfill for image variants.
//
// Pre-dates the resize-on-upload pipeline: every memorial hero and every
// contribution photo uploaded before this ran stores only the full-resolution
// original. This endpoint walks a batch of those docs, downloads each image
// from R2, generates `.400.webp` and `.800.webp` siblings via sharp, and
// flips `heroPhotoVariants` / `photoVariants` to true so the public page
// switches to the smaller files.
//
// Chunked: one call processes up to `limit` (default 20) docs for a given
// `target` (memorials or contributions). Response includes a `nextCursor` —
// hit the endpoint again with `?cursor=…` until `done: true` comes back.
// Already-flagged docs are skipped so re-runs are safe.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET } from '@/lib/r2';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { isSuperAdmin } from '@/lib/roles';
import { generateImageVariants } from '@/lib/image-variants';
import type { UserProfile } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 min — a batch of 20 full-res images can take a while

type Target = 'memorials' | 'contributions';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function extToMime(key: string): string | null {
  const ext = key.toLowerCase().split('.').pop() || '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return null;
}

async function downloadFromR2(key: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const res = await r2Client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    const stream = res.Body as any;
    if (!stream) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(chunk as Uint8Array);
    const buffer = Buffer.concat(chunks);
    const mimeType = res.ContentType || extToMime(key) || 'image/jpeg';
    return { buffer, mimeType };
  } catch (err) {
    console.error('backfill: R2 download failed', key, err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));

    const db = adminDb();
    const callerSnap = await db.collection('users').doc(uid).get();
    const caller = callerSnap.exists ? (callerSnap.data() as UserProfile) : null;
    if (!isSuperAdmin(caller)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const target = (searchParams.get('target') || 'memorials') as Target;
    if (target !== 'memorials' && target !== 'contributions') {
      return NextResponse.json({ error: 'Invalid target' }, { status: 400 });
    }
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number(searchParams.get('limit')) || DEFAULT_LIMIT),
    );
    const cursor = searchParams.get('cursor') || '';
    const dryRun = searchParams.get('dryRun') === '1';

    const collectionName = target === 'memorials' ? 'memorials' : 'contributions';
    const pathField = target === 'memorials' ? 'heroPhotoPath' : 'photoPath';
    const variantsField = target === 'memorials' ? 'heroPhotoVariants' : 'photoVariants';

    let query = db.collection(collectionName).orderBy('__name__').limit(limit);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();

    const results: Array<{ id: string; status: string; detail?: string }> = [];
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, any>;
      const path = data[pathField] as string | undefined;

      if (!path) {
        results.push({ id: doc.id, status: 'no_path' });
        skipped++;
        continue;
      }
      if (data[variantsField] === true) {
        results.push({ id: doc.id, status: 'already_done' });
        skipped++;
        continue;
      }

      if (dryRun) {
        results.push({ id: doc.id, status: 'would_backfill', detail: path });
        continue;
      }

      const dl = await downloadFromR2(path);
      if (!dl) {
        results.push({ id: doc.id, status: 'download_failed', detail: path });
        failed++;
        continue;
      }

      const ok = await generateImageVariants({
        originalKey: path,
        buffer: dl.buffer,
        mimeType: dl.mimeType,
      });

      if (!ok) {
        results.push({ id: doc.id, status: 'variants_not_generated', detail: dl.mimeType });
        // Mark as processed anyway so we don't keep retrying unsupported
        // formats (e.g. a gif hero slipped in before mime filtering).
        await doc.ref.update({ [variantsField]: false, variantsBackfilledAt: FieldValue.serverTimestamp() });
        skipped++;
        continue;
      }

      await doc.ref.update({
        [variantsField]: true,
        variantsBackfilledAt: FieldValue.serverTimestamp(),
      });
      results.push({ id: doc.id, status: 'updated' });
      updated++;
    }

    const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
    const done = nextCursor === null;

    return NextResponse.json({
      ok: true,
      target,
      scanned: snap.docs.length,
      updated,
      skipped,
      failed,
      nextCursor,
      done,
      dryRun,
      results,
    });
  } catch (err: any) {
    console.error('admin/backfill-variants error', err);
    return NextResponse.json(
      { error: err?.message || 'Backfill failed' },
      { status: 500 },
    );
  }
}
