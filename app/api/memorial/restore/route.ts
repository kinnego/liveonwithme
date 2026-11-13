// POST /api/memorial/restore { memorialId }
//
// Undo a keeper's delete within the 30 days: the memorial comes back as it
// was, online or offline. Only for deletes the keeper made themselves; an
// account deletion's orphaned memorials are handled by support.

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { isSuperAdmin } from '@/lib/roles';
import { writeAuditAdmin } from '@/lib/audit-admin';
import type { UserProfile } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const body = await req.json().catch(() => ({}));
    const memorialId = typeof body?.memorialId === 'string' ? body.memorialId : '';
    if (!memorialId || memorialId.includes('/')) return NextResponse.json({ error: 'Memorial not found.' }, { status: 404 });

    const db = adminDb();
    const ref = db.collection('memorials').doc(memorialId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'This memorial has already been deleted for good.' }, { status: 404 });
    const m = snap.data() as { ownerId?: string; slug?: string; pendingDeletionReason?: string; offlineBeforeDeletion?: boolean };

    const prof = (await db.collection('users').doc(uid).get()).data() as UserProfile | undefined;
    if (m.ownerId !== uid && !isSuperAdmin(prof ?? null)) {
      return NextResponse.json({ error: 'Only the memorial’s keeper can restore it.' }, { status: 403 });
    }
    if (m.pendingDeletionReason !== 'owner_deleted') {
      return NextResponse.json({ error: 'This memorial isn’t waiting to be deleted.' }, { status: 400 });
    }

    await ref.update({
      offline: m.offlineBeforeDeletion === true,
      offlineBeforeDeletion: FieldValue.delete(),
      pendingDeletionAt: FieldValue.delete(),
      pendingDeletionReason: FieldValue.delete(),
      deletedByUid: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await writeAuditAdmin({
      entityType: 'memorial',
      entityId: memorialId,
      action: 'owner_restored',
      actorUid: uid,
      actorEmail: prof?.email,
    });
    revalidatePath(`/m/${memorialId}`);
    if (m.slug) revalidatePath(`/m/${m.slug}`);
    revalidateTag(`memorial:${memorialId}`, { expire: 0 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('memorial/restore error', err);
    return NextResponse.json({ error: 'Could not restore the memorial. Please try again.' }, { status: 500 });
  }
}
