import { NextRequest, NextResponse } from 'next/server';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

// Returns the plotId linked to a referral's memorial, if any, so the partner
// referral page can surface a direct link into the plaque / QR designer.
// Partners can read their own referral via Firestore rules but not the
// memorial, so we proxy the one field they need.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const { searchParams } = new URL(req.url);
    const referralId = searchParams.get('referralId') || '';
    if (!referralId) return NextResponse.json({ error: 'referralId required' }, { status: 400 });

    const db = adminDb();
    const refSnap = await db.collection('referrals').doc(referralId).get();
    if (!refSnap.exists) return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    const referral = refSnap.data()!;
    if (referral.partnerUid !== uid) {
      return NextResponse.json({ error: 'Not your referral' }, { status: 403 });
    }

    const memorialId: string | undefined = referral.memorialId;
    if (!memorialId) return NextResponse.json({ plotId: null });

    const memSnap = await db.collection('memorials').doc(memorialId).get();
    if (!memSnap.exists) return NextResponse.json({ plotId: null });
    const plotId = memSnap.data()?.plotId || null;
    return NextResponse.json({ plotId });
  } catch (err: any) {
    console.error('partner/referral-plot error', err);
    return NextResponse.json({ error: err.message || 'Could not load plot' }, { status: 500 });
  }
}
