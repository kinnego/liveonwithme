import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET } from '@/lib/r2';
import { adminDb } from '@/lib/firebase-admin';
import type { Memorial } from '@/lib/types';

export const runtime = 'nodejs';

// Public counterpart to /api/memorial/hero-photo. The private route is gated to
// custodians because they can download high-res originals; this one is intended
// for the public memorial page's inline QR code, which needs the photo as a
// data URL to apply the SVG mono filter (filters can't sample cross-origin
// pixels, and R2's public endpoint is a different origin). Only serves live,
// public memorials — drafts and family-only pages stay dark.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = (searchParams.get('slug') || '').trim();
    if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

    const db = adminDb();
    const memSnap = await db.collection('memorials').doc(slug).get();
    if (!memSnap.exists) return NextResponse.json({ dataUrl: null });
    const memorial = { id: memSnap.id, ...(memSnap.data() as Omit<Memorial, 'id'>) };

    // Mirror MemorialView's client-side gate: any live memorial renders, so
    // its hero can appear in the QR too. Owners viewing drafts fall back to
    // the authenticated /api/memorial/hero-photo route on the client.
    if (memorial.status !== 'live') return NextResponse.json({ dataUrl: null });
    if ((memorial as any).offline === true) return NextResponse.json({ dataUrl: null });
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
    return NextResponse.json({
      dataUrl: `data:${contentType};base64,${buf.toString('base64')}`,
    });
  } catch (err: any) {
    console.error('memorial/public-hero-photo error', err);
    return NextResponse.json({ error: err.message || 'Could not load photo' }, { status: 500 });
  }
}
