// Look up friendly names/emails for a memorial's co-manager UIDs.
// The client can't read other users' profile docs directly (rules only allow
// isSelf), so the manage page calls this with its own auth token.

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb, verifyIdToken } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const callerUid = await verifyIdToken(req.headers.get('Authorization'));
    const { memorialId } = await req.json();

    if (!memorialId || typeof memorialId !== 'string') {
      return NextResponse.json({ error: 'memorialId is required' }, { status: 400 });
    }

    const db = adminDb();
    const memSnap = await db.collection('memorials').doc(memorialId).get();
    if (!memSnap.exists) {
      return NextResponse.json({ error: 'Memorial not found' }, { status: 404 });
    }

    const memorial = memSnap.data()!;
    const coManagerUids: string[] = memorial.coManagerUids || [];
    const isOwner = memorial.ownerId === callerUid;
    const isCoManager = coManagerUids.includes(callerUid);
    if (!isOwner && !isCoManager) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const results = await Promise.all(
      coManagerUids.map(async (uid) => {
        let email: string | undefined;
        let displayName: string | undefined;
        try {
          const profileSnap = await db.collection('users').doc(uid).get();
          if (profileSnap.exists) {
            const p = profileSnap.data() as { email?: string; displayName?: string };
            email = p.email;
            displayName = p.displayName;
          }
        } catch {
          /* fall through to auth lookup */
        }
        if (!email) {
          try {
            const authUser = await adminAuth().getUser(uid);
            email = authUser.email || undefined;
            if (!displayName) displayName = authUser.displayName || undefined;
          } catch {
            /* user may have been deleted — leave fields undefined */
          }
        }
        return { uid, email, displayName };
      })
    );

    return NextResponse.json({ coManagers: results });
  } catch (err: any) {
    console.error('co-manager-info error:', err);
    return NextResponse.json(
      { error: err.message || 'Could not load co-manager details' },
      { status: 500 }
    );
  }
}
