// POST /api/registrar/invite { placeId, email } — an existing registrar adds
// another person as a registrar of the same cemetery. The person needs an
// account already (any account: family, partner, whatever).

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { rateLimit } from '@/lib/rate-limit';
import {
  HttpError,
  REGISTRAR_COLLECTION,
  errorResponseBody,
  getCaller,
  parseCemetery,
  registrarDocId,
  requireRegistrar,
} from '@/lib/grave-records-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const body = await req.json().catch(() => ({}));
    const placeId = typeof body?.placeId === 'string' ? body.placeId.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!placeId || !email) throw new HttpError(400, 'An email address is required.');

    const db = adminDb();
    await requireRegistrar(db, caller, placeId);

    // Looking up accounts by email leaks whether an address is registered,
    // so keep it slow.
    const rl = await rateLimit(`registrar-invite:${caller.uid}`, { max: 20, windowSec: 3600 });
    if (!rl.allowed) throw new HttpError(429, 'Too many invites. Try again later.');

    let invitee;
    try {
      invitee = await adminAuth().getUserByEmail(email);
    } catch {
      throw new HttpError(
        404,
        'There’s no account with that email yet. Ask them to sign up on LiveOnWith.me first, then add them here.',
      );
    }

    // Copy the cemetery details from the inviter's own registrar doc (or any
    // grave record, for a super admin who isn't a registrar).
    const mine = await db.collection(REGISTRAR_COLLECTION).doc(registrarDocId(placeId, caller.uid)).get();
    let cemetery = mine.exists ? mine.data()?.cemetery : null;
    if (!cemetery) {
      const anyReg = await db.collection(REGISTRAR_COLLECTION).where('placeId', '==', placeId).limit(1).get();
      cemetery = anyReg.empty ? null : anyReg.docs[0].data().cemetery;
    }
    if (!cemetery) cemetery = parseCemetery(body?.cemetery);
    if (!cemetery) throw new HttpError(400, 'Cemetery details are missing.');

    const ref = db.collection(REGISTRAR_COLLECTION).doc(registrarDocId(placeId, invitee.uid));
    await ref.set({
      placeId,
      uid: invitee.uid,
      email: invitee.email || email,
      cemetery,
      status: 'active',
      addedByUid: caller.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    await writeAuditAdmin({
      entityType: 'cemeteryRegistrar',
      entityId: ref.id,
      action: 'added',
      actorUid: caller.uid,
      actorEmail: caller.email || undefined,
      details: { placeId, inviteeUid: invitee.uid },
    });

    return NextResponse.json({ ok: true, registrar: { uid: invitee.uid, email: invitee.email || email } });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
