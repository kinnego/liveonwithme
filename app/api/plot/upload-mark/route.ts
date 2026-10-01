import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET } from '@/lib/r2';
import { adminAuth, adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { checkPlotAccess } from '@/lib/plot-access';

export const runtime = 'nodejs';

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']);
const MAX_BYTES = 2 * 1024 * 1024;

function extForType(mime: string): string {
  if (mime === 'image/svg+xml') return 'svg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  return 'png';
}

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const plotId = (formData.get('plotId') as string) || '';
    if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    if (!plotId) return NextResponse.json({ error: 'Missing plotId' }, { status: 400 });

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Please upload a PNG, JPG, WebP or SVG.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'That image is over 2 MB — please pick a smaller one.' }, { status: 413 });
    }

    const db = adminDb();
    const { allowed, role, plot: plotSnap } = await checkPlotAccess(db, uid, plotId);
    if (!plotSnap) return NextResponse.json({ error: 'Plot not found' }, { status: 404 });
    if (!allowed)
      return NextResponse.json({ error: 'Only a plot administrator or referring partner can update the plaque mark.' }, { status: 403 });

    const path = `plots/${plotId}/mark-${Date.now()}.${extForType(file.type)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: path,
        Body: buffer,
        ContentType: file.type,
      })
    );

    const actor = await adminAuth().getUser(uid).catch(() => null);
    await db.collection('auditEvents').add({
      entityType: 'plot',
      entityId: plotId,
      action: 'plaque_mark_uploaded',
      actorUid: uid,
      actorEmail: actor?.email || null,
      actorRole: role,
      createdAt: new Date(),
      details: { path, type: file.type, size: file.size },
    });

    // Also return the mark as a data URL so the client can preview + rebuild
    // the plaque SVG without having to re-fetch from R2 (which would be a
    // cross-origin request subject to R2's CORS config).
    const dataUrl = `data:${file.type};base64,${buffer.toString('base64')}`;
    return NextResponse.json({ ok: true, path, type: file.type, dataUrl });
  } catch (err: any) {
    console.error('plot/upload-mark error', err);
    return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 });
  }
}
