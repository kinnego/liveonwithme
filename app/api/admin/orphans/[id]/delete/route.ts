// Super-admin only: hard-delete an orphaned memorial after the owner's
// 30-day grace window has lapsed. Reuses the sweep helper, so the deletion
// path is identical to what the retired nightly cron used.

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { isSuperAdmin } from '@/lib/roles';
import { deleteOrphanedMemorial } from '@/lib/orphan-admin';
import type { UserProfile } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const db = adminDb();
    const profSnap = await db.collection('users').doc(uid).get();
    const prof = profSnap.exists ? (profSnap.data() as UserProfile) : null;
    if (!isSuperAdmin(prof)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const memSnap = await db.collection('memorials').doc(id).get();
    if (!memSnap.exists) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const m = memSnap.data() as any;
    if (!m.pendingDeletionAt) {
      return NextResponse.json(
        { error: 'This memorial is not pending deletion.' },
        { status: 400 },
      );
    }
    const dueAt = m.pendingDeletionAt?.toDate?.() ?? new Date(0);
    if (dueAt.getTime() > Date.now()) {
      return NextResponse.json(
        { error: 'Grace window has not expired yet.' },
        { status: 400 },
      );
    }

    const result = await deleteOrphanedMemorial(id, uid, prof?.email);
    revalidatePath(`/m/${id}`);
    revalidateTag(`memorial:${id}`, { expire: 0 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('admin/orphans/delete error', err);
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 });
  }
}
