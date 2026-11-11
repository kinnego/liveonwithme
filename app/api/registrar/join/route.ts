// POST /api/registrar/join { cemetery } — become the first registrar of a
// cemetery. Open to any account with a verified email; no super-admin
// approval. Once a cemetery has a registrar, newcomers are added by them
// (see /api/registrar/invite), so each parish polices itself.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { sendRegistrarJoinedAdminNotice } from '@/lib/sendgrid';
import {
  HttpError,
  REGISTRAR_COLLECTION,
  errorResponseBody,
  getCaller,
  parseCemetery,
  registrarDocId,
} from '@/lib/grave-records-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    if (!caller.emailVerified && !caller.isSuperAdmin) {
      throw new HttpError(403, 'Please verify your email address first. Check your inbox for the link.');
    }
    const body = await req.json().catch(() => ({}));
    const cemetery = parseCemetery(body?.cemetery);
    if (!cemetery) throw new HttpError(400, 'Cemetery details are missing.');

    const db = adminDb();
    const ref = db.collection(REGISTRAR_COLLECTION).doc(registrarDocId(cemetery.placeId, caller.uid));

    // Check and create in one transaction, so two people pressing "Become
    // the registrar" at the same moment can't both become the first one.
    await db.runTransaction(async (tx) => {
      if (!caller.isSuperAdmin) {
        const existing = await tx.get(
          db
            .collection(REGISTRAR_COLLECTION)
            .where('placeId', '==', cemetery.placeId)
            .where('status', '==', 'active')
            .limit(1),
        );
        if (!existing.empty) {
          throw new HttpError(
            409,
            'This cemetery already has a registrar. Ask them to add you from their registrar page.',
          );
        }
      }
      tx.set(ref, {
        placeId: cemetery.placeId,
        uid: caller.uid,
        email: caller.email || '',
        cemetery,
        status: 'active',
        addedByUid: caller.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    await writeAuditAdmin({
      entityType: 'cemeteryRegistrar',
      entityId: ref.id,
      action: 'joined',
      actorUid: caller.uid,
      actorEmail: caller.email || undefined,
      details: { placeId: cemetery.placeId, cemeteryName: cemetery.name },
    });

    // Let the site owner know, without holding anyone up if email fails.
    try {
      await sendRegistrarJoinedAdminNotice({
        email: caller.email || '(no email)',
        cemeteryName: cemetery.name,
        placeId: cemetery.placeId,
        how: 'joined',
      });
    } catch (err) {
      console.error('Registrar notice email failed:', err);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
