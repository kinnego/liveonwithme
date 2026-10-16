import { NextRequest, NextResponse } from 'next/server';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { checkPlotAccess } from '@/lib/plot-access';

export const runtime = 'nodejs';

const PAID_STATUSES = new Set(['paid', 'paid_via_partner', 'paid_via_gift']);

// Thin client-callable wrapper around checkPlotAccess so the plaque / QR
// pages can decide whether to show the editor without each page having to
// replicate the server's authorisation rules. Also reports whether any
// memorial on the plot has been paid for — artwork previews are always
// available to managers, but downloads unlock once at least one person on
// the plot has gone live.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const { searchParams } = new URL(req.url);
    const plotId = searchParams.get('plotId') || '';
    if (!plotId) return NextResponse.json({ error: 'plotId required' }, { status: 400 });

    const db = adminDb();
    const { allowed, role, plot } = await checkPlotAccess(db, uid, plotId);
    if (!plot) return NextResponse.json({ error: 'Plot not found' }, { status: 404 });

    let anyMemorialPaid = false;
    if (allowed) {
      const memsSnap = await db
        .collection('memorials')
        .where('plotId', '==', plotId)
        .get();
      anyMemorialPaid = memsSnap.docs.some((d) =>
        PAID_STATUSES.has(d.data()?.paymentStatus),
      );
    }

    return NextResponse.json({ canManage: allowed, role, anyMemorialPaid });
  } catch (err: any) {
    console.error('plot/access error', err);
    return NextResponse.json({ error: 'Could not check access' }, { status: 500 });
  }
}
