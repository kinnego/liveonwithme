// Super admin: overview of cemetery registrars and open grave reports.
// GET  — active registrars + open reports (with the reported grave).
// POST { action: 'dismiss' | 'delete_grave', reportId } — resolve a report.
// Removing a registrar goes through /api/registrar/remove.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';
import {
  GRAVE_COLLECTION,
  GRAVE_REPORT_COLLECTION,
  HttpError,
  REGISTRAR_COLLECTION,
  errorResponseBody,
  getCaller,
  deleteUnlessAdopted,
  serializeGrave,
} from '@/lib/grave-records-admin';

export const runtime = 'nodejs';

async function requireAdmin(req: NextRequest) {
  const caller = await getCaller(req.headers.get('Authorization'));
  if (!caller.isSuperAdmin) throw new HttpError(403, 'Not authorized');
  return caller;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const db = adminDb();
    const [regSnap, repSnap] = await Promise.all([
      db.collection(REGISTRAR_COLLECTION).where('status', '==', 'active').get(),
      db.collection(GRAVE_REPORT_COLLECTION).where('status', '==', 'open').get(),
    ]);
    const reports = await Promise.all(
      repSnap.docs.map(async (d) => {
        const r = d.data();
        const g = await db.collection(GRAVE_COLLECTION).doc(r.graveRecordId).get();
        return {
          id: d.id,
          reason: r.reason,
          reporterEmail: r.reporterEmail || null,
          placeId: r.placeId,
          grave: g.exists ? serializeGrave(g.id, g.data()!) : null,
          cemeteryName: g.exists ? g.data()!.cemetery?.name || '' : '',
        };
      }),
    );
    return NextResponse.json({
      registrars: regSnap.docs.map((d) => {
        const r = d.data();
        return { uid: r.uid, email: r.email, placeId: r.placeId, cemeteryName: r.cemetery?.name || r.placeId };
      }),
      reports,
    });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const reportId = typeof body?.reportId === 'string' ? body.reportId : '';
    if (!reportId || (action !== 'dismiss' && action !== 'delete_grave')) {
      throw new HttpError(400, 'Bad request');
    }
    const db = adminDb();
    const repRef = db.collection(GRAVE_REPORT_COLLECTION).doc(reportId);
    const rep = await repRef.get();
    if (!rep.exists) throw new HttpError(404, 'Report not found');
    const { graveRecordId, placeId } = rep.data()!;

    if (action === 'delete_grave') {
      const gRef = db.collection(GRAVE_COLLECTION).doc(graveRecordId);
      const deleted = await deleteUnlessAdopted(db, gRef).catch((err) => {
        if (err instanceof HttpError && err.status === 409) {
          throw new HttpError(409, 'A family has adopted this grave; fix it from their plot instead.');
        }
        throw err;
      });
      if (deleted) {
        await writeAuditAdmin({
          entityType: 'graveRecord',
          entityId: graveRecordId,
          action: 'deleted_after_report',
          actorUid: caller.uid,
          actorEmail: caller.email || undefined,
          details: { placeId, reportId, burials: deleted.burials ?? [] },
        });
      }
    }

    await repRef.update({
      status: action === 'dismiss' ? 'dismissed' : 'actioned',
      decidedAt: FieldValue.serverTimestamp(),
      decidedByUid: caller.uid,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
