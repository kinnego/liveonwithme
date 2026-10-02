// Server-side lookup of a custody invite by token. The client page used
// to query Firestore directly, but that query is subject to the
// custodyTransfers.list rule — which denies anyone signed in with an
// email that doesn't match the invite. The invitee would then see a
// raw "Missing or insufficient permissions" error, not a helpful
// "sign in with the right account" message.
//
// We expose public-safe fields only (status, nominationType, toEmail,
// memorial name). The 32-byte random token is already the gate; anyone
// with the token can see the invite details, which is the same guarantee
// a magic link makes.

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }

    const db = adminDb();
    const snap = await db
      .collection('custodyTransfers')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ found: false });
    }

    const transfer = snap.docs[0].data();
    const memorialSnap = await db.collection('memorials').doc(transfer.memorialId).get();
    const memorialName = memorialSnap.exists ? memorialSnap.data()?.fullName || '' : '';

    return NextResponse.json({
      found: true,
      status: transfer.status,
      nominationType: transfer.nominationType,
      toEmail: transfer.toEmail,
      memorial: {
        id: transfer.memorialId,
        fullName: memorialName,
      },
    });
  } catch (err: any) {
    console.error('custody lookup error:', err);
    return NextResponse.json(
      { error: err.message || 'Something went wrong loading this invitation.' },
      { status: 500 }
    );
  }
}
