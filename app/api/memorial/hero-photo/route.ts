import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET } from '@/lib/r2';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { canEditMemorial, isSuperAdmin } from '@/lib/roles';
import type { Memorial, UserProfile } from '@/lib/types';

export const runtime = 'nodejs';

// Proxies the memorial's hero photo from R2 and returns it as a base64 data
// URL. The memorial plaque designer embeds this photo into the centre of the
// QR, and canvasing the resulting SVG for a PNG preview/download would be
// blocked by CORS if the photo were loaded straight from the R2 public URL.
// Gated to memorial custodians (ownerId, successors, super admins).
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const { searchParams } = new URL(req.url);
    const memorialId = searchParams.get('memorialId') || '';
    if (!memorialId) return NextResponse.json({ error: 'memorialId required' }, { status: 400 });

    const db = adminDb();
    const memSnap = await db.collection('memorials').doc(memorialId).get();
    if (!memSnap.exists) return NextResponse.json({ error: 'Memorial not found' }, { status: 404 });
    const memorial = { id: memSnap.id, ...(memSnap.data() as Omit<Memorial, 'id'>) };

    const profSnap = await db.collection('users').doc(uid).get();
    const prof = profSnap.exists ? (profSnap.data() as UserProfile) : null;
    const allowed =
      canEditMemorial(uid, memorial) ||
      (memorial.successorUids || []).includes(uid) ||
      isSuperAdmin(prof);
    if (!allowed) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });

    if (!memorial.heroPhotoPath) return NextResponse.json({ dataUrl: null });

    const res = await r2Client.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: memorial.heroPhotoPath }),
    );
    const stream = res.Body as any;
    if (!stream) return NextResponse.json({ dataUrl: null });
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(chunk as Uint8Array);
    const buf = Buffer.concat(chunks);
    const contentType = res.ContentType || 'image/jpeg';
    return NextResponse.json({ dataUrl: `data:${contentType};base64,${buf.toString('base64')}` });
  } catch (err: any) {
    console.error('memorial/hero-photo error', err);
    return NextResponse.json({ error: err.message || 'Could not load photo' }, { status: 500 });
  }
}
