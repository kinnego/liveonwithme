// Server-side contribution writer. Replaces the client-side addDoc that used
// to live in MemorialView, so the public memorial page can ship without the
// Firestore client SDK.
//
// Trust model:
//   - Anonymous visitor: can only create `status: 'pending'` on a live
//     (published, not offline) memorial. Matches the old client-side rule.
//   - Signed-in keeper (owner / co-manager): their submission auto-approves
//     (`status: 'approved'`, `source: 'family'`), same as the manage-memorial
//     add-memory flow — and the public page cache is busted so the memory
//     appears immediately.
//
// Rate-limited by IP so a script can't spray submissions at one memorial.

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { canEditMemorial } from '@/lib/roles';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req.headers);
    const rl = await rateLimit(`contribution-create:ip:${ip}`, {
      max: 15,
      windowSec: 3600,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many submissions. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const memorialId = String(body.memorialId || '').trim();
    const contributorName = String(body.contributorName || '').trim();
    if (!memorialId || !contributorName) {
      return NextResponse.json(
        { error: 'memorialId and contributorName are required' },
        { status: 400 },
      );
    }

    const db = adminDb();
    const memSnap = await db.collection('memorials').doc(memorialId).get();
    if (!memSnap.exists) {
      return NextResponse.json({ error: 'Memorial not found' }, { status: 404 });
    }
    const memorial = memSnap.data() as any;

    // Identify keeper, if any — their submissions auto-approve.
    const authHeader = req.headers.get('Authorization');
    let keeperUid: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice('Bearer '.length);
        const decoded = await adminAuth().verifyIdToken(token);
        keeperUid = decoded.uid;
      } catch {
        // invalid token — treat as anonymous
      }
    }
    const isKeeper = !!keeperUid && canEditMemorial(keeperUid, memorial);

    if (!isKeeper) {
      if (memorial.status !== 'live' || memorial.offline === true) {
        return NextResponse.json(
          { error: 'This memorial is not accepting contributions yet.' },
          { status: 403 },
        );
      }
    }

    const photoPath = String(body.photoPath || '');
    const audience = body.audience === 'family_only' ? 'family_only' : 'public';

    const docData: Record<string, unknown> = {
      memorialId,
      contributorName,
      contributorEmail: String(body.contributorEmail || ''),
      relationship: String(body.relationship || ''),
      memory: String(body.memory || ''),
      caption: String(body.caption || ''),
      photoPath,
      photoVariants: body.photoVariants === true,
      status: isKeeper ? 'approved' : 'pending',
      audience,
      mediaType: photoPath ? 'photo' : 'text',
      sizeBytes: typeof body.sizeBytes === 'number' ? body.sizeBytes : 0,
      createdAt: FieldValue.serverTimestamp(),
    };
    if (isKeeper) {
      docData.source = 'family';
    }

    const ref = await db.collection('contributions').add(docData);

    // Auto-approved submissions (keeper path) need to show on the public page
    // right away. Pending submissions don't — they're invisible until a keeper
    // approves them, and that flow busts the cache itself.
    if (isKeeper) {
      revalidateTag(`memorial:${memorialId}`, { expire: 0 });
    }

    return NextResponse.json({ id: ref.id });
  } catch (err: any) {
    console.error('contribution/create error', err);
    return NextResponse.json(
      { error: 'Could not save the contribution.' },
      { status: 500 },
    );
  }
}
