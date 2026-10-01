import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET } from '@/lib/r2';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { checkPlotAccess } from '@/lib/plot-access';

export const runtime = 'nodejs';

// Proxies the plot's custom plaque mark from R2 and returns it as a base64
// data URL. This exists so the plaque builder page can embed the mark into
// the generated SVG without doing a cross-origin fetch to R2 (which would
// require CORS configuration on the bucket and would also taint the canvas
// when rendering a preview PNG).
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const { searchParams } = new URL(req.url);
    const plotId = searchParams.get('plotId') || '';
    if (!plotId) return NextResponse.json({ error: 'plotId required' }, { status: 400 });

    const db = adminDb();
    const { allowed, plot: plotSnap } = await checkPlotAccess(db, uid, plotId);
    if (!plotSnap) return NextResponse.json({ error: 'Plot not found' }, { status: 404 });
    if (!allowed) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
    const plot = plotSnap.data()!;

    const customMarkPath: string | undefined = plot.plaqueDesign?.customMarkPath;
    if (!customMarkPath) return NextResponse.json({ dataUrl: null });

    const res = await r2Client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: customMarkPath }));
    const chunks: Uint8Array[] = [];
    const stream = res.Body as any;
    if (!stream) return NextResponse.json({ dataUrl: null });
    for await (const chunk of stream) chunks.push(chunk as Uint8Array);
    const buf = Buffer.concat(chunks);
    const contentType = res.ContentType || 'image/png';
    return NextResponse.json({ dataUrl: `data:${contentType};base64,${buf.toString('base64')}` });
  } catch (err: any) {
    console.error('plot/mark error', err);
    return NextResponse.json({ error: err.message || 'Could not load mark' }, { status: 500 });
  }
}
