// GET /api/grave-records/uploads?placeId=X — the spreadsheets registrars
// have uploaded for this cemetery, newest first (without the file text).

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

export async function GET(req: NextRequest) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const placeId = req.nextUrl.searchParams.get('placeId') || '';
    if (!placeId) throw new HttpError(400, 'placeId required');
    const db = adminDb();
    await requireRegistrar(db, caller, placeId);
    const snap = await db
      .collection(UPLOAD_COLLECTION)
      .where('placeId', '==', placeId)
      .select('fileName', 'mode', 'uploadedByEmail', 'people', 'graves', 'added', 'updated', 'skipped', 'uncertainCells', 'createdAt')
      .get();
    const uploads = snap.docs
      .map((d) => {
        const u = d.data();
        return {
          id: d.id,
          fileName: u.fileName,
          mode: u.mode,
          uploadedByEmail: u.uploadedByEmail || null,
          people: u.people,
          graves: u.graves,
          added: u.added,
          updated: u.updated,
          skipped: u.skipped,
          uncertainCells: u.uncertainCells,
          createdAt: u.createdAt?.toMillis?.() ?? null,
        };
      })
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return NextResponse.json({ uploads });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
