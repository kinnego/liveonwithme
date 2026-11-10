// GET  /api/grave-records?placeId=X — the cemetery's register, for its
//      registrars (and the super admin).
// POST /api/grave-records { cemetery, section, row, plotNumber, burials,
//      inscription, lat, lng } — a registrar adds a grave.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { rateLimit } from '@/lib/rate-limit';
import {
  GRAVE_COLLECTION,
  HttpError,
  REGISTRAR_DAILY_WRITE_CAP,
  errorResponseBody,
  getCaller,
  parseCemetery,
  parseGraveInput,
  rebuildGraveIndex,
  requireRegistrar,
  serializeGrave,
} from '@/lib/grave-records-admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const placeId = req.nextUrl.searchParams.get('placeId') || '';
    if (!placeId) throw new HttpError(400, 'placeId required');
    const db = adminDb();
    await requireRegistrar(db, caller, placeId);
    const snap = await db.collection(GRAVE_COLLECTION).where('placeId', '==', placeId).get();
    return NextResponse.json({
      graves: snap.docs.map((d) => serializeGrave(d.id, d.data())),
    });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const cemetery = parseCemetery(body.cemetery);
    if (!cemetery) throw new HttpError(400, 'Cemetery details are missing.');
    const db = adminDb();
    await requireRegistrar(db, caller, cemetery.placeId);

    if (!caller.isSuperAdmin) {
      const rl = await rateLimit(`grave-write:${caller.uid}`, {
        max: REGISTRAR_DAILY_WRITE_CAP,
        windowSec: 24 * 3600,
      });
      if (!rl.allowed) {
        throw new HttpError(429, `You’ve reached today’s limit of ${REGISTRAR_DAILY_WRITE_CAP} changes. Please carry on tomorrow.`);
      }
    }

    const input = parseGraveInput(body);
    const ref = db.collection(GRAVE_COLLECTION).doc();
    const data = {
      placeId: cemetery.placeId,
      cemetery,
      ...input,
      status: 'unclaimed',
      adoptedPlotId: null,
      source: 'registrar',
      createdByUid: caller.uid,
      updatedByUid: caller.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await ref.set(data);
    await rebuildGraveIndex(db, cemetery.placeId);

    await writeAuditAdmin({
      entityType: 'graveRecord',
      entityId: ref.id,
      action: 'created',
      actorUid: caller.uid,
      actorEmail: caller.email || undefined,
      details: { placeId: cemetery.placeId, burials: input.burials.length },
    });

    const saved = await ref.get();
    return NextResponse.json({ grave: serializeGrave(ref.id, saved.data() || {}) });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
