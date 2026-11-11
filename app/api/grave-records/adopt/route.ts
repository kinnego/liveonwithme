// POST /api/grave-records/adopt { graveRecordId, memorialId }
//
// The family said "Yes, this is the grave". In one transaction: create a
// normal Plot from the register entry (keeping its pin and label), attach
// the memorial to it, and mark the register entry adopted. The memorial's
// owner becomes the plot admin, exactly as when creating a plot by hand.
//
// If someone else adopted the grave first, the client falls back to the
// existing "ask to join this plot" PlotMembership request.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { canEditMemorial } from '@/lib/roles';
import { graveLabel } from '@/lib/grave-match';
import {
  GRAVE_COLLECTION,
  HttpError,
  errorResponseBody,
  getCaller,
  uniquePlotShortId,
} from '@/lib/grave-records-admin';
import type { GraveRecord, Memorial } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const body = await req.json().catch(() => ({}));
    const graveRecordId = typeof body?.graveRecordId === 'string' ? body.graveRecordId : '';
    const memorialId = typeof body?.memorialId === 'string' ? body.memorialId : '';
    if (!graveRecordId || !memorialId) throw new HttpError(400, 'graveRecordId and memorialId are required.');

    const db = adminDb();
    const graveRef = db.collection(GRAVE_COLLECTION).doc(graveRecordId);
    const memRef = db.collection('memorials').doc(memorialId);
    const plotRef = db.collection('plots').doc();
    const membershipRef = db.collection('plotMemberships').doc();

    const result = await db.runTransaction(async (tx) => {
      const [graveSnap, memSnap] = await Promise.all([tx.get(graveRef), tx.get(memRef)]);
      if (!graveSnap.exists) throw new HttpError(404, 'That grave is no longer in the register.');
      if (!memSnap.exists) throw new HttpError(404, 'Memorial not found.');
      const grave = graveSnap.data() as GraveRecord;
      const memorial = memSnap.data() as Memorial;
      if (!canEditMemorial(caller.uid, memorial)) throw new HttpError(403, 'Not your memorial.');
      if (memorial.plotId) throw new HttpError(409, 'This memorial already has a resting place.');
      if (grave.status === 'adopted') {
        return { alreadyAdopted: true as const, plotId: grave.adoptedPlotId || null };
      }

      const sId = await uniquePlotShortId(db, tx);
      const label = graveLabel(grave);
      const hasPin = typeof grave.lat === 'number' && typeof grave.lng === 'number';

      tx.set(plotRef, {
        shortId: sId,
        cemetery: grave.cemetery,
        plotAdminUids: [memorial.ownerId],
        plotAdminSuccessorUids: [],
        createdByUid: memorial.ownerId,
        sourceGraveRecordId: graveRecordId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(label ? { name: label } : {}),
        ...(hasPin ? { lat: grave.lat, lng: grave.lng } : {}),
      });
      tx.set(membershipRef, {
        plotId: plotRef.id,
        memorialId,
        requestedByUid: caller.uid,
        status: 'approved',
        approvedByUid: memorial.ownerId,
        approvedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        ...(memorial.personId ? { personId: memorial.personId } : {}),
      });
      tx.update(memRef, { plotId: plotRef.id, updatedAt: FieldValue.serverTimestamp() });
      tx.update(graveRef, {
        status: 'adopted',
        adoptedPlotId: plotRef.id,
        adoptedByUid: caller.uid,
        adoptedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { alreadyAdopted: false as const, plotId: plotRef.id, placeId: grave.placeId };
    });

    if (result.alreadyAdopted) {
      return NextResponse.json(
        {
          error: 'Another family member already looks after this grave.',
          code: 'already_adopted',
          plotId: result.plotId,
        },
        { status: 409 },
      );
    }

    await Promise.all([
      writeAuditAdmin({
        entityType: 'graveRecord',
        entityId: graveRecordId,
        action: 'adopted',
        actorUid: caller.uid,
        actorEmail: caller.email || undefined,
        details: { memorialId, plotId: result.plotId },
      }),
      writeAuditAdmin({
        entityType: 'plot',
        entityId: result.plotId,
        action: 'linked_to_memorial',
        actorUid: caller.uid,
        actorEmail: caller.email || undefined,
        details: { memorialId, fromGraveRecordId: graveRecordId },
      }),
    ]);

    return NextResponse.json({ ok: true, plotId: result.plotId });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
