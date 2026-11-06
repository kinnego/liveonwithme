// Cache-buster for the public memorial page. Family-side writes (approving a
// memory, editing the page, deleting a clip, taking the page offline) happen
// directly from the browser against Firestore — the server never hears about
// them, so without this endpoint the 1h ISR cache keeps serving the old HTML
// until it naturally expires.
//
// The keeper's browser calls POST /api/memorial/revalidate after each save
// and we purge the memorial's cache tag + path immediately. Fire-and-forget
// on the client: a missed revalidate falls back to the natural TTL.

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { canEditMemorial, isSuperAdmin } from '@/lib/roles';
import type { UserProfile } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    let uid: string;
    try {
      uid = (await adminAuth().verifyIdToken(authHeader.slice('Bearer '.length))).uid;
    } catch {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const memorialId =
      body && typeof body.memorialId === 'string' ? body.memorialId.trim() : '';
    if (!memorialId) {
      return NextResponse.json({ error: 'memorialId required' }, { status: 400 });
    }

    const db = adminDb();
    const memSnap = await db.collection('memorials').doc(memorialId).get();
    if (!memSnap.exists) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const memorial = memSnap.data() as any;

    // Permission model mirrors the manage page: owner, co-manager, successor,
    // or super admin can request a revalidate. Anyone else is rejected so
    // this endpoint can't be used to pound the ISR cache from a script.
    let allowed = canEditMemorial(uid, memorial);
    if (!allowed && (memorial.successorUids || []).includes(uid)) allowed = true;
    if (!allowed) {
      const profSnap = await db.collection('users').doc(uid).get();
      const prof = profSnap.exists ? (profSnap.data() as UserProfile) : null;
      if (isSuperAdmin(prof)) allowed = true;
    }
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const slug = memorial.slug || memorialId;
    revalidatePath(`/m/${slug}`);
    revalidateTag(`memorial:${memorialId}`, { expire: 0 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('memorial/revalidate error', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
