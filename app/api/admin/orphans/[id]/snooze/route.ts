// Super-admin only: push an orphan's review date 30 days further out.
// Useful when the admin wants more time to decide, or when a family
// member has reached out and might still claim the page.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { isSuperAdmin } from '@/lib/roles';
import { writeAuditAdmin } from '@/lib/audit-admin';
import type { UserProfile } from '@/lib/types';

export const runtime = 'nodejs';

const SNOOZE_DAYS = 30;

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

    const memRef = db.collection('memorials').doc(id);
    const memSnap = await memRef.get();
    if (!memSnap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const next = Timestamp.fromDate(
      new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000),
    );
    await memRef.update({
      pendingDeletionAt: next,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditAdmin({
      entityType: 'memorial',
      entityId: id,
      action: 'orphan_snoozed',
      actorUid: uid,
      actorEmail: prof?.email,
      details: { newPendingDeletionAt: next.toDate().toISOString() },
    });

    return NextResponse.json({ ok: true, pendingDeletionAt: next.toDate().toISOString() });
  } catch (err: any) {
    console.error('admin/orphans/snooze error', err);
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 });
  }
}
