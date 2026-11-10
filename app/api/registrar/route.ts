// GET /api/registrar?placeId=X — the caller's registrar status for one
// cemetery (and, when they are a registrar, who the other registrars are).
// GET /api/registrar — every cemetery the caller is a registrar of.

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import {
  REGISTRAR_COLLECTION,
  errorResponseBody,
  getCaller,
  isActiveRegistrar,
} from '@/lib/grave-records-admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const db = adminDb();
    const placeId = req.nextUrl.searchParams.get('placeId') || '';

    if (!placeId) {
      const snap = await db
        .collection(REGISTRAR_COLLECTION)
        .where('uid', '==', caller.uid)
        .where('status', '==', 'active')
        .get();
      return NextResponse.json({
        cemeteries: snap.docs.map((d) => d.data().cemetery),
      });
    }

    const [isRegistrar, othersSnap] = await Promise.all([
      isActiveRegistrar(db, placeId, caller.uid),
      db
        .collection(REGISTRAR_COLLECTION)
        .where('placeId', '==', placeId)
        .where('status', '==', 'active')
        .limit(50)
        .get(),
    ]);
    const canManage = isRegistrar || caller.isSuperAdmin;

    return NextResponse.json({
      isRegistrar,
      isSuperAdmin: caller.isSuperAdmin,
      emailVerified: caller.emailVerified,
      registrarCount: othersSnap.size,
      cemetery: othersSnap.empty ? null : othersSnap.docs[0].data().cemetery,
      // Becoming the first registrar is open; after that it's by invite.
      canJoin: !isRegistrar && othersSnap.size === 0,
      // Registrar emails are only shown to fellow registrars.
      registrars: canManage
        ? othersSnap.docs.map((d) => ({ uid: d.data().uid, email: d.data().email }))
        : [],
    });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
