// Upload endpoint for the partner public-page hero photo. Writes to R2 under
// a per-partner prefix with a server-chosen key, so there is no way for the
// client to overwrite another partner's object or climb out of the prefix.
// The user doc's partnerHeroPhotoPath field is written by the client after
// the upload returns (firestore.rules already allow self-writes to it).

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { r2Client, R2_BUCKET } from '@/lib/r2';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import type { UserProfile } from '@/lib/types';

export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — plenty for a hero at 1600px wide.

interface Format {
  ext: string;
  mime: string;
  matches: (buf: Buffer) => boolean;
}

const FORMATS: Format[] = [
  {
    ext: 'jpg',
    mime: 'image/jpeg',
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: 'png',
    mime: 'image/png',
    matches: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    matches: (b) =>
      b.length >= 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
];

function detect(buf: Buffer): Format | null {
  for (const f of FORMATS) if (f.matches(buf)) return f;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const callerUid = await verifyIdToken(req.headers.get('Authorization'));

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const targetUidRaw = (formData.get('targetUid') as string) || '';
    if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'That photo is larger than 10 MB. Please resize.' }, { status: 413 });
    }

    const db = adminDb();
    const callerSnap = await db.collection('users').doc(callerUid).get();
    if (!callerSnap.exists) return NextResponse.json({ error: 'Profile not found' }, { status: 403 });
    const caller = callerSnap.data() as UserProfile;
    const isSuperAdmin = caller.role === 'super_admin';

    const targetUid = targetUidRaw && targetUidRaw !== callerUid ? targetUidRaw : callerUid;
    if (targetUid !== callerUid && !isSuperAdmin) {
      return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
    }

    // Only approved partners (or a super admin on their own demo account) may
    // own a hero photo — matches who can own a /partner/<slug> page.
    const targetSnap =
      targetUid === callerUid ? callerSnap : await db.collection('users').doc(targetUid).get();
    if (!targetSnap.exists) {
      return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
    }
    const target = targetSnap.data() as UserProfile;
    const targetIsPartner = target.role === 'partner' && target.partnerStatus === 'approved';
    const targetIsSuperAdmin = target.role === 'super_admin';
    if (!targetIsPartner && !targetIsSuperAdmin) {
      return NextResponse.json({ error: 'Target is not an approved partner' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = detect(buffer);
    if (!detected) {
      return NextResponse.json(
        { error: 'That file type isn\'t supported. Try JPEG, PNG, or WebP.' },
        { status: 400 },
      );
    }

    const key = `partners/${targetUid}/hero-${randomUUID()}.${detected.ext}`;
    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: detected.mime,
      }),
    );

    return NextResponse.json({ path: key, sizeBytes: file.size, contentType: detected.mime });
  } catch (err: any) {
    console.error('partner/hero-photo error', err);
    return NextResponse.json({ error: err?.message || 'Upload failed' }, { status: 500 });
  }
}
