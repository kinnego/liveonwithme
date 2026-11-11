// GET /api/graves/search?q=Bridget+O'Donnell[&placeId=...]
// GET /api/graves/search?placeId=...  → { count } of graves in that register
//
// Public search of the parish burial registers, so anyone can find a
// grave and go to it. No sign-in. One Firestore query on the precomputed
// `searchKeys` (see lib/grave-match.ts), refined in memory so every word
// typed has to match the same person.

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { graveLabel, matchBurialForTerms, searchTerms } from '@/lib/grave-match';
import { GRAVE_COLLECTION, GRAVE_INDEX_COLLECTION } from '@/lib/grave-records-admin';
import { publicBurial } from '@/lib/grave-public';
import type { GraveRecord } from '@/lib/types';

export const runtime = 'nodejs';

const SCAN = 150;
const RETURN = 12;

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').slice(0, 80);
  const placeId = (req.nextUrl.searchParams.get('placeId') || '').slice(0, 200);
  const terms = searchTerms(q);
  if (terms.length === 0) {
    // With a cemetery and no name: just say whether it has a register, so
    // the cemetery page knows to show the search box. One small read.
    if (placeId && !q) {
      try {
        const snap = await adminDb().collection(GRAVE_INDEX_COLLECTION).doc(placeId).get();
        return NextResponse.json({ results: [], count: snap.exists ? Number(snap.data()?.count) || 0 : 0 });
      } catch {
        return NextResponse.json({ results: [], count: 0 });
      }
    }
    return NextResponse.json({ results: [] });
  }

  try {
    const rl = await rateLimit(`grave-search:${clientIp(req.headers)}`, { max: 300, windowSec: 600 });
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many searches. Please wait a few minutes.' }, { status: 429 });
    }
    // Query on the term with the longest spelling: it narrows the most.
    const pivot = [...terms].sort((a, b) => Math.max(...b.map((v) => v.length)) - Math.max(...a.map((v) => v.length)))[0];
    const db = adminDb();
    const base = db.collection(GRAVE_COLLECTION).where('searchKeys', 'array-contains-any', pivot.slice(0, 30));
    let docs;
    if (placeId) {
      try {
        docs = (await base.where('placeId', '==', placeId).limit(SCAN).get()).docs;
      } catch {
        // Composite index not deployed yet: search everywhere and filter.
        docs = (await base.limit(SCAN * 3).get()).docs.filter((d) => d.data().placeId === placeId);
      }
    } else {
      docs = (await base.limit(SCAN).get()).docs;
    }

    const results = [];
    for (const d of docs) {
      const g = d.data() as GraveRecord;
      const i = matchBurialForTerms(g.burials || [], terms);
      if (i < 0) continue;
      const b = publicBurial(g.burials[i]);
      results.push({
        id: d.id,
        name: b.name,
        nickname: b.nickname,
        died: b.died,
        age: b.age,
        cemeteryName: g.cemetery?.name || '',
        placeId: g.placeId,
        label: graveLabel(g),
        hasPin: typeof g.lat === 'number',
        others: (g.burials || []).length - 1,
      });
      if (results.length >= RETURN) break;
    }
    return NextResponse.json({ results });
  } catch (err) {
    console.error('Grave search failed:', err);
    return NextResponse.json({ error: 'Search failed.' }, { status: 500 });
  }
}
