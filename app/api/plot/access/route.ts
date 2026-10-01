import { NextRequest, NextResponse } from 'next/server';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { checkPlotAccess } from '@/lib/plot-access';

export const runtime = 'nodejs';

// Thin client-callable wrapper around checkPlotAccess so the plaque / QR
// pages can decide whether to show the editor without each page having to
// replicate the server's authorisation rules.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const { searchParams } = new URL(req.url);
    const plotId = searchParams.get('plotId') || '';
    if (!plotId) return NextResponse.json({ error: 'plotId required' }, { status: 400 });

    const db = adminDb();
    const { allowed, role, plot } = await checkPlotAccess(db, uid, plotId);
    if (!plot) return NextResponse.json({ error: 'Plot not found' }, { status: 404 });
    return NextResponse.json({ canManage: allowed, role });
  } catch (err: any) {
    console.error('plot/access error', err);
    return NextResponse.json({ error: err.message || 'Could not check access' }, { status: 500 });
  }
}
