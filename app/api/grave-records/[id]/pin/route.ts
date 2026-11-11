// POST /api/grave-records/[id]/pin { lat, lng } — set (or, with nulls,
// clear) just the map pin. Used by "walk the graveyard" mode, where the
// registrar searches for the name on the headstone in front of them and
// taps "Pin here".

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
  rebuildGraveIndex,
  requireRegistrar,
} from '@/lib/grave-records-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const clear = body?.lat === null && body?.lng === null;
    const lat = typeof body?.lat === 'number' && Number.isFinite(body.lat) && Math.abs(body.lat) <= 90 ? body.lat : null;
    const lng = typeof body?.lng === 'number' && Number.isFinite(body.lng) && Math.abs(body.lng) <= 180 ? body.lng : null;
    if (!clear && (lat === null || lng === null)) throw new HttpError(400, 'A location is required.');

    const db = adminDb();
    const ref = db.collection(GRAVE_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'Grave not found.');
    const placeId = snap.data()!.placeId as string;
    await requireRegistrar(db, caller, placeId);
    if (snap.data()!.status === 'adopted') {
      throw new HttpError(409, 'A family looks after this grave now; they can set the pin from their plot page.');
    }
    if (!caller.isSuperAdmin) {
      const rl = await rateLimit(`grave-write:${caller.uid}`, { max: REGISTRAR_DAILY_WRITE_CAP, windowSec: 24 * 3600 });
      if (!rl.allowed) throw new HttpError(429, 'You’ve reached today’s limit of changes. Please carry on tomorrow.');
    }

    await ref.update({
      lat: clear ? null : lat,
      lng: clear ? null : lng,
      updatedByUid: caller.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await rebuildGraveIndex(db, placeId);
    await writeAuditAdmin({
      entityType: 'graveRecord',
      entityId: id,
      action: clear ? 'pin_cleared' : 'pinned',
      actorUid: caller.uid,
      actorEmail: caller.email || undefined,
      details: clear ? { placeId } : { placeId, lat, lng },
    });
    return NextResponse.json({ ok: true, lat: clear ? null : lat, lng: clear ? null : lng });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
