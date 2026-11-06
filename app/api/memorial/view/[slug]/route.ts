// Slow-path reader for /m/[slug]. The server page (`app/m/[slug]/page.tsx`)
// returns null to the client component for anything that isn't live-and-
// visible to the public, because the server ISR cache has to be safe to
// share across all visitors. When the client component gets `null` it
// hits this endpoint with an ID token so an owner (or co-manager /
// successor / super admin) can preview their own draft/offline memorial
// at the public URL.
//
// The response bundles memorial + plot + approved contributions + clips so
// the preview page gets the same shape as the public fast path; the
// client component treats both uniformly.

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { isSuperAdmin } from '@/lib/roles';
import type { UserProfile } from '@/lib/types';

export const runtime = 'nodejs';

function strip<T>(x: T): T {
  // JSON round-trip strips Firestore Timestamps + undefined fields so the
  // payload serialises cleanly over the wire.
  return JSON.parse(JSON.stringify(x));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    if (!slug) {
      return NextResponse.json({ error: 'slug required' }, { status: 400 });
    }

    const authHeader = req.headers.get('Authorization');
    let uid: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice('Bearer '.length);
        uid = (await adminAuth().verifyIdToken(token)).uid;
      } catch {
        // Treat invalid token as anonymous — we'll only hand back live-
        // and-public data below.
      }
    }

    const db = adminDb();
    const memSnap = await db.collection('memorials').doc(slug).get();
    if (!memSnap.exists) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const memorial = memSnap.data() as any;

    const isLive = memorial.status === 'live';
    const isOffline = memorial.offline === true;
    const visibility = memorial.visibility;
    const visibleToPublic =
      isLive &&
      !isOffline &&
      ['public', 'unlisted', 'private'].includes(visibility);

    let isKeeper = false;
    if (uid) {
      if (
        memorial.ownerId === uid ||
        (memorial.coManagerUids || []).includes(uid) ||
        (memorial.successorUids || []).includes(uid)
      ) {
        isKeeper = true;
      } else {
        const profSnap = await db.collection('users').doc(uid).get();
        const prof = profSnap.exists
          ? (profSnap.data() as UserProfile)
          : null;
        if (isSuperAdmin(prof)) isKeeper = true;
      }
    }

    if (!visibleToPublic && !isKeeper) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const [plotSnap, contribSnap, clipsSnap] = await Promise.all([
      memorial.plotId
        ? db.collection('plots').doc(memorial.plotId).get()
        : Promise.resolve(null),
      db
        .collection('contributions')
        .where('memorialId', '==', memSnap.id)
        .where('status', '==', 'approved')
        .get(),
      db
        .collection('memorials')
        .doc(memSnap.id)
        .collection('clips')
        .orderBy('createdAt', 'asc')
        .get(),
    ]);

    let plot: { lat?: number; lng?: number; cemetery?: any } | null = null;
    if (plotSnap && plotSnap.exists) {
      const pd = plotSnap.data() as any;
      plot = {};
      if (typeof pd.lat === 'number' && typeof pd.lng === 'number') {
        plot.lat = pd.lat;
        plot.lng = pd.lng;
      }
      if (pd.cemetery) plot.cemetery = strip(pd.cemetery);
    }

    const contributions = contribSnap.docs.map((d) => ({
      id: d.id,
      ...strip(d.data()),
    }));
    const clips = clipsSnap.docs.map((d) => ({
      id: d.id,
      ...strip(d.data()),
    }));

    return NextResponse.json({
      memorial: { id: memSnap.id, ...strip(memorial) },
      plot,
      contributions,
      clips,
      isPreview: isKeeper && !visibleToPublic,
    });
  } catch (err: any) {
    console.error('memorial/view error', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
