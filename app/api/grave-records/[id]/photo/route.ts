// POST   /api/grave-records/[id]/photo — a registrar adds or replaces the
//        photo of a grave's headstone (multipart, field "file").
// DELETE /api/grave-records/[id]/photo — a registrar takes it down.
// Only while the grave is unclaimed: once a family adopts it, the photos
// live on their plot page.
//
// The server picks the storage key and checks the file really is an image
// by its first bytes, whatever its name or claimed type says.

import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { r2Client, R2_BUCKET } from '@/lib/r2';
import { adminDb } from '@/lib/firebase-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { rateLimit } from '@/lib/rate-limit';
import {
  GRAVE_COLLECTION,
  HttpError,
  REGISTRAR_DAILY_WRITE_CAP,
  errorResponseBody,
  getCaller,
  requireRegistrar,
  type Caller,
} from '@/lib/grave-records-admin';

export const runtime = 'nodejs';

// The page shrinks photos before sending, so this only stops misuse.
const MAX_BYTES = 4 * 1024 * 1024;

function imageType(b: Buffer): { ext: string; mime: string } | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return { ext: 'png', mime: 'image/png' };
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

async function loadForPhoto(caller: Caller, id: string) {
  const db = adminDb();
  const ref = db.collection(GRAVE_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Grave not found.');
  const placeId = snap.data()!.placeId as string;
  await requireRegistrar(db, caller, placeId);
  if (snap.data()!.status === 'adopted' && !caller.isSuperAdmin) {
    throw new HttpError(409, 'A family looks after this grave now, so photos go on their page.');
  }
  if (!caller.isSuperAdmin) {
    const rl = await rateLimit(`grave-write:${caller.uid}`, { max: REGISTRAR_DAILY_WRITE_CAP, windowSec: 24 * 3600 });
    if (!rl.allowed) {
      throw new HttpError(429, `You’ve reached today’s limit of ${REGISTRAR_DAILY_WRITE_CAP} changes. Please carry on tomorrow.`);
    }
  }
  return { db, ref, placeId };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const { id } = await params;
    const { ref, placeId } = await loadForPhoto(caller, id);
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') throw new HttpError(400, 'Please choose a photo.');
    if (file.size > MAX_BYTES) throw new HttpError(413, 'That photo is too big. Please try a smaller one.');
    const buf = Buffer.from(await file.arrayBuffer());
    const type = imageType(buf);
    if (!type) throw new HttpError(400, 'Please choose a photo (JPG, PNG or WebP).');

    const path = `graves/${id}/headstone-${randomUUID()}.${type.ext}`;
    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: path,
        Body: buf,
        ContentType: type.mime,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    await ref.update({ photoPath: path, updatedByUid: caller.uid, updatedAt: FieldValue.serverTimestamp() });
    await writeAuditAdmin({
      entityType: 'graveRecord',
      entityId: id,
      action: 'headstone_photo_added',
      actorUid: caller.uid,
      actorEmail: caller.email || undefined,
      details: { placeId, path, size: buf.length },
    });
    return NextResponse.json({ ok: true, photoPath: path });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const { id } = await params;
    const { ref, placeId } = await loadForPhoto(caller, id);
    // The file stays in storage, so a removal by mistake can be undone.
    await ref.update({ photoPath: null, updatedByUid: caller.uid, updatedAt: FieldValue.serverTimestamp() });
    await writeAuditAdmin({
      entityType: 'graveRecord',
      entityId: id,
      action: 'headstone_photo_removed',
      actorUid: caller.uid,
      actorEmail: caller.email || undefined,
      details: { placeId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
