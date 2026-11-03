// Super-admin only: return every memorial whose owner deleted their
// account and which has no successor/co-manager promotion target. The
// client renders this on /admin/orphans so an admin can review each one
// and either delete the memorial or push the review date out.

import { NextRequest, NextResponse } from 'next/server';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { isSuperAdmin } from '@/lib/roles';
import { listOrphans } from '@/lib/orphan-admin';
import type { UserProfile } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const db = adminDb();
    const profSnap = await db.collection('users').doc(uid).get();
    const prof = profSnap.exists ? (profSnap.data() as UserProfile) : null;
    if (!isSuperAdmin(prof)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    const rows = await listOrphans();
    return NextResponse.json({
      ok: true,
      orphans: rows.map((r) => ({
        ...r,
        pendingDeletionAt: r.pendingDeletionAt?.toISOString() || null,
      })),
    });
  } catch (err: any) {
    console.error('admin/orphans/list error', err);
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 });
  }
}
