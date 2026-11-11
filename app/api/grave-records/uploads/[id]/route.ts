// GET /api/grave-records/uploads/[id] — download an uploaded spreadsheet
// exactly as it was sent (as CSV text).

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import {
  HttpError,
  UPLOAD_COLLECTION,
  errorResponseBody,
  getCaller,
  requireRegistrar,
} from '@/lib/grave-records-admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const { id } = await params;
    const db = adminDb();
    const snap = await db.collection(UPLOAD_COLLECTION).doc(id).get();
    if (!snap.exists) throw new HttpError(404, 'Upload not found.');
    const u = snap.data()!;
    await requireRegistrar(db, caller, u.placeId);
    return NextResponse.json({ fileName: u.fileName, text: u.text || '' });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
