// POST /api/grave-records/suggest { memorialId, placeId }
//
// "Could this be the grave you're looking for?" — fuzzy-matches the
// memorial's name and year of death against the cemetery's burial register.
// One indexed query reads only graves whose surname could match (see
// candidateGraves), then one read per suggestion returned. Never claims
// anything: the family decides.
//
// Only the memorial's owner or co-managers can ask. (The register itself is
// publicly searchable through /api/graves/search; this is the fuzzy,
// memorial-shaped match used when adopting a grave.)

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { rateLimit } from '@/lib/rate-limit';
import { canEditMemorial } from '@/lib/roles';
import { matchGraves, splitFullName, yearOf } from '@/lib/grave-match';
import {
  GRAVE_COLLECTION,
  HttpError,
  errorResponseBody,
  getCaller,
  candidateGraves,
} from '@/lib/grave-records-admin';
import type { GraveRecord, Memorial } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const body = await req.json().catch(() => ({}));
    const memorialId = typeof body?.memorialId === 'string' ? body.memorialId : '';
    const placeId = typeof body?.placeId === 'string' ? body.placeId : '';
    if (!memorialId || !placeId) throw new HttpError(400, 'memorialId and placeId are required.');

    const rl = await rateLimit(`grave-suggest:${caller.uid}`, { max: 60, windowSec: 3600 });
    if (!rl.allowed) throw new HttpError(429, 'Too many searches. Try again later.');

    const db = adminDb();
    const memSnap = await db.collection('memorials').doc(memorialId).get();
    if (!memSnap.exists) throw new HttpError(404, 'Memorial not found.');
    const memorial = memSnap.data() as Memorial;
    if (!canEditMemorial(caller.uid, memorial)) throw new HttpError(403, 'Not your memorial.');

    const { forenames, surname } = splitFullName(memorial.fullName || '');
    const entries = await candidateGraves(db, placeId, surname);
    if (entries.length === 0) return NextResponse.json({ suggestions: [] });

    const matches = matchGraves({ forenames, surname, diedYear: yearOf(memorial.died) }, entries);

    // Hydrate the few matches with the full record, for the inscription and
    // the dates as written in the register.
    const suggestions = await Promise.all(
      matches.map(async (m) => {
        const snap = await db.collection(GRAVE_COLLECTION).doc(m.entry.id).get();
        const g = (snap.data() || {}) as Partial<GraveRecord>;
        return {
          id: m.entry.id,
          label: m.entry.l,
          matchedIndex: m.burialIndex,
          burials: (g.burials || []).map((b) => ({
            name: [b.forenames, b.surname].filter(Boolean).join(' '),
            died: b.died || (b.diedYear ? String(b.diedYear) : ''),
            age: b.age || '',
            // Details that help a family recognise their own.
            nickname: b.nickname || '',
            relations: b.relations || '',
            address: b.address || '',
          })),
          inscription: g.inscription || '',
          hasPin: m.entry.g,
          lat: typeof g.lat === 'number' ? g.lat : null,
          lng: typeof g.lng === 'number' ? g.lng : null,
          adopted: m.entry.a,
          plotId: m.entry.p,
        };
      }),
    );

    return NextResponse.json({ suggestions });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
