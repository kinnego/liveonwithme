// Super admin: permanently delete a memorial now, with its memories and the
// photos and audio in storage. The same full clean-up as the Orphans page,
// without waiting out a grace period. The admin types the person's name to
// confirm, and the deletion is in the audit trail.

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { isSuperAdmin } from '@/lib/roles';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { deleteOrphanedMemorial } from '@/lib/orphan-admin';
import type { UserProfile } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const db = adminDb();
    const prof = (await db.collection('users').doc(uid).get()).data() as UserProfile | undefined;
    if (!isSuperAdmin(prof ?? null)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

    const { id } = await params;
    if (!id || id.includes('/')) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const confirmName = typeof body?.confirmName === 'string' ? body.confirmName : '';

    const snap = await db.collection('memorials').doc(id).get();
    if (!snap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const m = snap.data() as { fullName?: string; slug?: string; ownerId?: string; status?: string; paymentStatus?: string };
    if (!norm(m.fullName || '') || norm(confirmName) !== norm(m.fullName || '')) {
      return NextResponse.json({ error: 'The name doesn’t match.' }, { status: 400 });
    }

    const result = await deleteOrphanedMemorial(id, uid, prof?.email);
    await writeAuditAdmin({
      entityType: 'memorial',
      entityId: id,
      action: 'admin_deleted',
      actorUid: uid,
      actorEmail: prof?.email,
      details: { fullName: m.fullName || '', ownerId: m.ownerId || '', status: m.status || '', paymentStatus: m.paymentStatus || '', ...result },
    });
    revalidatePath(`/m/${id}`);
    if (m.slug) revalidatePath(`/m/${m.slug}`);
    revalidateTag(`memorial:${id}`, { expire: 0 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('admin/memorials/delete error', err);
    return NextResponse.json({ error: err?.message || 'Delete failed' }, { status: 500 });
  }
}
