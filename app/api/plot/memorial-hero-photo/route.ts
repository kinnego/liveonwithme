import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET } from '@/lib/r2';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { checkPlotAccess } from '@/lib/plot-access';
import type { Memorial } from '@/lib/types';

export const runtime = 'nodejs';

// Returns the hero photo of the first live memorial on this plot as a base64
// data URL. The plot QR page embeds this into the centre of the engraved QR,
// and canvasing the SVG for a PNG preview would be CORS-blocked if the photo
// were loaded straight from R2. Gated to plot custodians (admin, successor,
// super admin, partner) via checkPlotAccess.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const { searchParams } = new URL(req.url);
    const plotId = (searchParams.get('plotId') || '').trim();
    if (!plotId) return NextResponse.json({ error: 'plotId required' }, { status: 400 });

    const db = adminDb();
    const { allowed, plot } = await checkPlotAccess(db, uid, plotId);
    if (!plot) return NextResponse.json({ error: 'Plot not found' }, { status: 404 });
    if (!allowed) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });

    const membershipsSnap = await db
      .collection('plotMemberships')
      .where('plotId', '==', plotId)
      .where('status', '==', 'approved')
      .get();

    const memorialIds = membershipsSnap.docs
      .map((d) => d.data().memorialId as string)
      .filter(Boolean);

    for (const id of memorialIds) {
      const memSnap = await db.collection('memorials').doc(id).get();
      if (!memSnap.exists) continue;
      const memorial = { id: memSnap.id, ...(memSnap.data() as Omit<Memorial, 'id'>) };
      if (memorial.status !== 'live') continue;
      if (!memorial.heroPhotoPath) continue;

      const res = await r2Client.send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: memorial.heroPhotoPath }),
      );
      const stream = res.Body as any;
      if (!stream) continue;
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) chunks.push(chunk as Uint8Array);
      const buf = Buffer.concat(chunks);
      const contentType = res.ContentType || 'image/jpeg';
      return NextResponse.json({
        dataUrl: `data:${contentType};base64,${buf.toString('base64')}`,
        memorialId: memorial.id,
      });
    }

    return NextResponse.json({ dataUrl: null });
  } catch (err: any) {
    console.error('plot/memorial-hero-photo error', err);
    return NextResponse.json({ error: err.message || 'Could not load photo' }, { status: 500 });
  }
}
