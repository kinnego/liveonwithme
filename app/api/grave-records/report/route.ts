// POST /api/grave-records/report { graveRecordId, reason } — a family flags
// a register entry that looks wrong. Lands on /admin/registrars; nothing
// changes automatically.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { rateLimit } from '@/lib/rate-limit';
import {
  GRAVE_COLLECTION,
  GRAVE_REPORT_COLLECTION,
  HttpError,
  errorResponseBody,
  getCaller,
} from '@/lib/grave-records-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const body = await req.json().catch(() => ({}));
    const graveRecordId = typeof body?.graveRecordId === 'string' ? body.graveRecordId : '';
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 1000) : '';
    if (!graveRecordId) throw new HttpError(400, 'graveRecordId required');
    if (reason.length < 3) throw new HttpError(400, 'Please tell us what looks wrong.');

    const rl = await rateLimit(`grave-report:${caller.uid}`, { max: 10, windowSec: 3600 });
    if (!rl.allowed) throw new HttpError(429, 'Too many reports. Try again later.');

    const db = adminDb();
    const grave = await db.collection(GRAVE_COLLECTION).doc(graveRecordId).get();
    if (!grave.exists) throw new HttpError(404, 'Grave not found.');

    await db.collection(GRAVE_REPORT_COLLECTION).add({
      graveRecordId,
      placeId: grave.data()!.placeId,
      reason,
      reporterUid: caller.uid,
      reporterEmail: caller.email || null,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
