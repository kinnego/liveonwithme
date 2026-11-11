// POST /api/registrar/remove { placeId, uid } — a registrar steps down, or a
// super admin removes someone. Records they added stay in the register.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';
import {
  HttpError,
  REGISTRAR_COLLECTION,
  errorResponseBody,
  getCaller,
  registrarDocId,
} from '@/lib/grave-records-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const body = await req.json().catch(() => ({}));
    const placeId = typeof body?.placeId === 'string' ? body.placeId : '';
    const uid = typeof body?.uid === 'string' ? body.uid : '';
    if (!placeId || !uid) throw new HttpError(400, 'placeId and uid are required.');
    if (uid !== caller.uid && !caller.isSuperAdmin) {
      throw new HttpError(403, 'Only a site admin can remove another registrar.');
    }

    const db = adminDb();
    const ref = db.collection(REGISTRAR_COLLECTION).doc(registrarDocId(placeId, uid));
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'Registrar not found.');
    await ref.update({
      status: 'removed',
      removedAt: FieldValue.serverTimestamp(),
      removedByUid: caller.uid,
    });

    await writeAuditAdmin({
      entityType: 'cemeteryRegistrar',
      entityId: ref.id,
      action: uid === caller.uid ? 'stepped_down' : 'removed',
      actorUid: caller.uid,
      actorEmail: caller.email || undefined,
      details: { placeId, uid },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
