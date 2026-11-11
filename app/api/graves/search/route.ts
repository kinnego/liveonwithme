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
import { GRAVE_COLLECTION, registerCount } from '@/lib/grave-records-admin';
import { publicBurial } from '@/lib/grave-public';
import type { GraveRecord } from '@/lib/types';

export const runtime = 'nodejs';

// Records read per search, at most. Bounds the cost of any one request.
const SCAN = 100;
const RETURN = 12;

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').slice(0, 80);
  const placeId = (req.nextUrl.searchParams.get('placeId') || '').slice(0, 200);
  const terms = searchTerms(q);
  const countOnly = !!placeId && !q;
  if (terms.length === 0 && !countOnly) return NextResponse.json({ results: [] });

  try {
    // Every path that touches Firestore is rate limited per IP, including
    // the register count below.
    const rl = await rateLimit(`grave-search:${clientIp(req.headers)}`, { max: 120, windowSec: 600 });
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many searches. Please wait a few minutes.' }, { status: 429 });
    }

    if (countOnly) {
      // With a cemetery and no name: just say whether it has a register, so
      // the cemetery page knows to show the search box. A count
      // aggregation: about one read per 1,000 graves.
      // The CDN keeps the answer for 5 minutes, so repeat visits and QR
      // scans of a busy graveyard don't reach the database at all.
      const count = await registerCount(adminDb(), placeId);
      return NextResponse.json(
        { results: [], count },
        { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } },
      );
    }

    // Query on the term with the longest spelling: it narrows the most.
    const pivot = [...terms].sort((a, b) => Math.max(...b.map((v) => v.length)) - Math.max(...a.map((v) => v.length)))[0];
    const db = adminDb();
    const base = db.collection(GRAVE_COLLECTION).where('searchKeys', 'array-contains-any', pivot.slice(0, 30));
    // Per-cemetery search needs the (placeId, searchKeys) composite index
    // in firestore.indexes.json.
    const docs = (await (placeId ? base.where('placeId', '==', placeId) : base).limit(SCAN).get()).docs;

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
