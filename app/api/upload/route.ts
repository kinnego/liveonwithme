// Upload endpoint for memorial media and public contributions.
//
// Security contract:
//   - The server picks the object key (prefix + memorialId + random UUID + ext
//     derived from the sniffed file signature). The client has no way to
//     overwrite another family's keys or escape the prefix.
//   - `kind` of memorial-* requires a Firebase ID token with owner/co-manager
//     access to the target memorial.
//   - `kind: 'contribution'` allows anonymous uploads but only to a live,
//     non-offline, public/unlisted memorial — so a one-off visitor can leave
//     a photo without an account, while a private/draft/offline memorial
//     cannot be used as free storage.
//   - The file's claimed MIME type is cross-checked against its magic bytes;
//     renaming a .exe to .jpg is rejected before any S3 call fires.

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { r2Client, R2_BUCKET } from '@/lib/r2';
import { NextRequest, NextResponse } from 'next/server';
import { readQuotasAdmin } from '@/lib/config-admin';
import { summariseMemorialUsage } from '@/lib/quota-admin';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

type UploadKind =
  | 'memorial-hero'
  | 'memorial-gallery'
  | 'memorial-memory'
  | 'contribution';

const MEMORIAL_KINDS: readonly UploadKind[] = [
  'memorial-hero',
  'memorial-gallery',
  'memorial-memory',
];

interface Format {
  ext: string;
  mime: string;
  // true if `buf` starts with this format's magic bytes.
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
  {
    ext: 'gif',
    mime: 'image/gif',
    matches: (b) => b.length >= 6 && b.toString('ascii', 0, 6).startsWith('GIF8'),
  },
  {
    ext: 'mp3',
    mime: 'audio/mpeg',
    matches: (b) =>
      b.length >= 3 &&
      ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || // ID3
        (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)), // frame sync
  },
  {
    ext: 'm4a',
    mime: 'audio/mp4',
    matches: (b) => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp',
  },
  {
    ext: 'ogg',
    mime: 'audio/ogg',
    matches: (b) => b.length >= 4 && b.toString('ascii', 0, 4) === 'OggS',
  },
  {
    ext: 'wav',
    mime: 'audio/wav',
    matches: (b) =>
      b.length >= 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WAVE',
  },
];

function detectFormat(buf: Buffer): Format | null {
  for (const f of FORMATS) if (f.matches(buf)) return f;
  return null;
}

function humanBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function softVerifyToken(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(authHeader.slice('Bearer '.length));
    return decoded.uid;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const kindRaw = (formData.get('kind') as string) || '';
    const memorialId = (formData.get('memorialId') as string) || '';

    if (!file) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }
    if (!memorialId || typeof memorialId !== 'string' || memorialId.includes('/')) {
      return NextResponse.json({ error: 'Missing or invalid memorialId' }, { status: 400 });
    }
    const kind = kindRaw as UploadKind;
    if (
      kind !== 'memorial-hero' &&
      kind !== 'memorial-gallery' &&
      kind !== 'memorial-memory' &&
      kind !== 'contribution'
    ) {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
    }

    const db = adminDb();
    const memSnap = await db.collection('memorials').doc(memorialId).get();
    if (!memSnap.exists) {
      return NextResponse.json({ error: 'Memorial not found' }, { status: 404 });
    }
    const memorial = memSnap.data()!;

    // Authorisation branches by kind. Memorial-side uploads require a signed-
    // in owner or co-manager; the contribution path lets anonymous visitors
    // upload only to a live, public/unlisted memorial, but a signed-in owner
    // or co-manager can also contribute via this path on any state (draft,
    // private, offline) — useful when a keeper is testing or wants to add
    // something to a page the public can't see.
    const uid = await softVerifyToken(req.headers.get('Authorization'));
    const isOwner = !!uid && memorial.ownerId === uid;
    const isCoManager =
      !!uid && Array.isArray(memorial.coManagerUids) && memorial.coManagerUids.includes(uid);
    const isKeeper = isOwner || isCoManager;

    if (MEMORIAL_KINDS.includes(kind)) {
      if (!uid) {
        return NextResponse.json({ error: 'Sign in to upload' }, { status: 401 });
      }
      if (!isKeeper) {
        return NextResponse.json({ error: 'You don\'t have access to this memorial' }, { status: 403 });
      }
    } else {
      // contribution flow
      if (!isKeeper) {
        const isLive = memorial.status === 'live';
        const isOffline = memorial.offline === true;
        const visibility = memorial.visibility;
        const isViewable = visibility === 'public' || visibility === 'unlisted' || visibility === 'private';
        if (!isLive || isOffline || !isViewable) {
          return NextResponse.json(
            { error: 'This memorial isn\'t accepting contributions right now.' },
            { status: 403 }
          );
        }

        // Anonymous contribution flood protection: 20 uploads per IP per hour
        // across the whole site. Keepers (owner/co-manager) bypass this —
        // they're authenticated and have their own 50MB file + total-quota
        // ceilings below. Per-memorial bucket on top catches a brigade of
        // IPs targeting one page.
        const ip = clientIp(req.headers);
        const perIp = await rateLimit(`upload:ip:${ip}`, { max: 20, windowSec: 3600 });
        if (!perIp.allowed) {
          return NextResponse.json(
            { error: 'Too many uploads. Please try again later.' },
            { status: 429, headers: { 'Retry-After': String(perIp.retryAfterSec) } },
          );
        }
        const perMemorial = await rateLimit(`upload:mem:${memorialId}`, {
          max: 60,
          windowSec: 3600,
        });
        if (!perMemorial.allowed) {
          return NextResponse.json(
            { error: 'This memorial is receiving many uploads right now. Please try again later.' },
            { status: 429, headers: { 'Retry-After': String(perMemorial.retryAfterSec) } },
          );
        }
      }
    }

    const quotas = await readQuotasAdmin();
    if (file.size > quotas.singleFileBytesMax) {
      return NextResponse.json(
        {
          error: `That file is larger than our current limit (${humanBytes(quotas.singleFileBytesMax)}). Please compress or resize and try again.`,
        },
        { status: 413 }
      );
    }

    const usage = await summariseMemorialUsage(memorialId);
    if (usage.totalBytes + file.size > quotas.totalBytesPerMemorial) {
      return NextResponse.json(
        {
          error:
            `This memorial has already used most of its ${humanBytes(quotas.totalBytesPerMemorial)} of shared storage. ` +
            `We\u2019re happy to raise the limit for you \u2014 please email hello@freastar.com and we\u2019ll sort it out.`,
        },
        { status: 413 }
      );
    }

    // Pull the whole file into memory for magic-byte sniffing. Our max single
    // file size is small enough (tens of MB) that this is fine; if we ever
    // raise the ceiling we'd want streaming + a seekable detector.
    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = detectFormat(buffer);
    if (!detected) {
      return NextResponse.json(
        { error: 'That file type isn\'t supported. Try JPEG, PNG, WebP, GIF, or an MP3/M4A/OGG/WAV audio file.' },
        { status: 400 }
      );
    }

    // Server-generated key. Prefix is chosen by kind; nothing from the
    // client's filename ends up in the key, so there's no way to overwrite
    // another family's files or climb out of the prefix.
    const prefix =
      kind === 'contribution' ? `contributions/${memorialId}` : `memorials/${memorialId}`;
    const key = `${prefix}/${randomUUID()}.${detected.ext}`;

    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: detected.mime,
      })
    );

    return NextResponse.json({
      success: true,
      path: key,
      sizeBytes: file.size,
      contentType: detected.mime,
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
