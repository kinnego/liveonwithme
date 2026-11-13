// POST /api/memorial/delete { memorialId, confirmName }
//
// The memorial's owner (or the super admin) deletes it. It goes offline at
// once, so nobody can see it, and is held for 30 days in case it was a
// mistake: the owner can restore it from their dashboard until then. After
// that it appears on the admin Orphans page, where the final, permanent
// deletion of the page, its memories and its photos is done.
//
// The owner types the person's name to confirm, so a stray tap can't do it.

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { isSuperAdmin } from '@/lib/roles';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import type { UserProfile } from '@/lib/types';

export const runtime = 'nodejs';

const KEEPER_DELETE_DAYS = 30;

function sameName(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  return n(a) !== '' && n(a) === n(b);
}

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const rl = await rateLimit(`memorial-delete:uid:${uid}:ip:${clientIp(req.headers)}`, { max: 10, windowSec: 3600 });
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });

    const body = await req.json().catch(() => ({}));
    const memorialId = typeof body?.memorialId === 'string' ? body.memorialId : '';
    const confirmName = typeof body?.confirmName === 'string' ? body.confirmName : '';
    if (!memorialId || memorialId.includes('/')) return NextResponse.json({ error: 'Memorial not found.' }, { status: 404 });

    const db = adminDb();
    const ref = db.collection('memorials').doc(memorialId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Memorial not found.' }, { status: 404 });
    const m = snap.data() as { ownerId?: string; fullName?: string; offline?: boolean; pendingDeletionAt?: unknown; slug?: string };

    const prof = (await db.collection('users').doc(uid).get()).data() as UserProfile | undefined;
    const admin = isSuperAdmin(prof ?? null);
    if (m.ownerId !== uid && !admin) {
      return NextResponse.json({ error: 'Only the memorial’s keeper can delete it.' }, { status: 403 });
    }
    if (!sameName(confirmName, m.fullName || '')) {
      return NextResponse.json({ error: 'The name doesn’t match. Please type it exactly as it appears on the memorial.' }, { status: 400 });
    }
    if (m.pendingDeletionAt) return NextResponse.json({ ok: true, alreadyPending: true });

    const dueAt = Timestamp.fromMillis(Date.now() + KEEPER_DELETE_DAYS * 24 * 3600 * 1000);
    await ref.update({
      offline: true,
      // Kept so a restore puts the memorial back exactly as it was.
      offlineBeforeDeletion: m.offline === true,
      pendingDeletionAt: dueAt,
      pendingDeletionReason: 'owner_deleted',
      deletedByUid: uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditAdmin({
      entityType: 'memorial',
      entityId: memorialId,
      action: 'owner_deleted',
      actorUid: uid,
      actorEmail: prof?.email,
      details: { fullName: m.fullName || '', dueAt: dueAt.toDate().toISOString(), byAdmin: admin && m.ownerId !== uid },
    });

    revalidatePath(`/m/${memorialId}`);
    if (m.slug) revalidatePath(`/m/${m.slug}`);
    revalidateTag(`memorial:${memorialId}`, { expire: 0 });
    return NextResponse.json({ ok: true, dueAt: dueAt.toMillis() });
  } catch (err: any) {
    console.error('memorial/delete error', err);
    return NextResponse.json({ error: 'Could not delete the memorial. Please try again.' }, { status: 500 });
  }
}
