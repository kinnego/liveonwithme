import { NextRequest, NextResponse } from 'next/server';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

// Returns the plotId linked to each referral's memorial, if any, so the partner
// dashboard and referral page can surface direct links into the plaque / QR
// designer. Partners can read their own referrals via Firestore rules but not
// the memorial, so we proxy the one field they need. Non-owned referrals are
// silently skipped so the response leaks nothing.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get('referralIds') || '';
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return NextResponse.json({ plots: {} });

    const db = adminDb();
    const refSnaps = await Promise.all(ids.map((id) => db.collection('referrals').doc(id).get()));

    const plots: Record<string, string | null> = {};
    const memorialLookups: Array<{ refId: string; memorialId: string }> = [];

    for (const snap of refSnaps) {
      if (!snap.exists) continue;
      const data = snap.data()!;
      if (data.partnerUid !== uid) continue;
      if (!data.memorialId) {
        plots[snap.id] = null;
        continue;
      }
      memorialLookups.push({ refId: snap.id, memorialId: data.memorialId });
    }

    const memSnaps = await Promise.all(
      memorialLookups.map((x) => db.collection('memorials').doc(x.memorialId).get()),
    );
    memorialLookups.forEach((x, i) => {
      plots[x.refId] = memSnaps[i].exists ? memSnaps[i].data()?.plotId || null : null;
    });

    return NextResponse.json({ plots });
  } catch (err: any) {
    console.error('partner/referral-plot error', err);
    return NextResponse.json({ error: 'Could not load plots' }, { status: 500 });
  }
}
