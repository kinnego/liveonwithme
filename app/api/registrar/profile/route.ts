// GET  /api/registrar/profile?placeId=X — answers to "Tell us about your register".
// POST /api/registrar/profile { placeId, format, fields, notes } — save them.
// The answers shape the spreadsheet template and AI prompt we hand the
// registrar, and tell us what kind of records parishes actually hold.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { REGISTER_FIELDS } from '@/lib/register-parse';
import {
  HttpError,
  PROFILE_COLLECTION,
  errorResponseBody,
  getCaller,
  requireRegistrar,
} from '@/lib/grave-records-admin';

export const runtime = 'nodejs';

const FORMATS = ['handwritten', 'typed', 'spreadsheet', 'cards', 'other'];

export async function GET(req: NextRequest) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const placeId = req.nextUrl.searchParams.get('placeId') || '';
    if (!placeId) throw new HttpError(400, 'placeId required');
    const db = adminDb();
    await requireRegistrar(db, caller, placeId);
    const snap = await db.collection(PROFILE_COLLECTION).doc(placeId).get();
    if (!snap.exists) return NextResponse.json({ profile: null });
    const p = snap.data()!;
    return NextResponse.json({ profile: { format: p.format, fields: p.fields || [], notes: p.notes || '' } });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const body = await req.json().catch(() => ({}));
    const placeId = typeof body?.placeId === 'string' ? body.placeId : '';
    if (!placeId) throw new HttpError(400, 'placeId required');
    const format = FORMATS.includes(body?.format) ? body.format : 'other';
    const allowed = new Set(REGISTER_FIELDS.filter((f) => f.askable).map((f) => f.key as string));
    const fields = Array.isArray(body?.fields) ? body.fields.filter((f: unknown) => typeof f === 'string' && allowed.has(f)) : [];
    const notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 1000) : '';
    const db = adminDb();
    await requireRegistrar(db, caller, placeId);
    await db.collection(PROFILE_COLLECTION).doc(placeId).set({
      placeId,
      format,
      fields,
      notes,
      updatedByUid: caller.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
