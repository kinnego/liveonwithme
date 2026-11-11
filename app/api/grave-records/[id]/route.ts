// PATCH  /api/grave-records/[id] — a registrar fixes a grave.
// DELETE /api/grave-records/[id] — a registrar removes a grave.
// Both only while the grave is unclaimed: once a family adopts it, the
// plot is theirs and the register entry is read-only.

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
  parseGraveInput,
  rebuildGraveIndex,
  requireRegistrar,
  serializeGrave,
  type Caller,
} from '@/lib/grave-records-admin';

export const runtime = 'nodejs';

async function loadEditable(caller: Caller, id: string) {
  const db = adminDb();
  const ref = db.collection(GRAVE_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Grave not found.');
  const placeId = snap.data()!.placeId as string;
  await requireRegistrar(db, caller, placeId);
  if (snap.data()!.status === 'adopted' && !caller.isSuperAdmin) {
    throw new HttpError(409, 'A family looks after this grave now, so it can’t be changed here.');
  }
  if (!caller.isSuperAdmin) {
    const rl = await rateLimit(`grave-write:${caller.uid}`, {
      max: REGISTRAR_DAILY_WRITE_CAP,
      windowSec: 24 * 3600,
    });
    if (!rl.allowed) {
      throw new HttpError(429, `You’ve reached today’s limit of ${REGISTRAR_DAILY_WRITE_CAP} changes. Please carry on tomorrow.`);
    }
  }
  return { db, ref, placeId };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const { id } = await params;
    const { db, ref, placeId } = await loadEditable(caller, id);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const input = parseGraveInput(body);
    await ref.update({
      ...input,
      editedByHand: true,
      updatedByUid: caller.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await rebuildGraveIndex(db, placeId);
    await writeAuditAdmin({
      entityType: 'graveRecord',
      entityId: id,
      action: 'updated',
      actorUid: caller.uid,
      actorEmail: caller.email || undefined,
      details: { placeId },
    });
    const saved = await ref.get();
    return NextResponse.json({ grave: serializeGrave(id, saved.data() || {}) });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const { id } = await params;
    const { db, ref, placeId } = await loadEditable(caller, id);
    const before = (await ref.get()).data();
    await ref.delete();
    await rebuildGraveIndex(db, placeId);
    await writeAuditAdmin({
      entityType: 'graveRecord',
      entityId: id,
      action: 'deleted',
      actorUid: caller.uid,
      actorEmail: caller.email || undefined,
      // Keep the deleted names in the audit trail so a bad delete can be
      // put back by hand.
      details: { placeId, burials: before?.burials ?? [], section: before?.section, row: before?.row, plotNumber: before?.plotNumber },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
