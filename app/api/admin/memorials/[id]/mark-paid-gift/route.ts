// Super-admin override: publish a memorial as a gift (no charge).
//
// Used for family & friends — the regular Stripe flow stays untouched, and
// Stripe-dashboard promotion codes still exist as a parallel comp path for
// visitors we can't reach through the console. This route is the ONLY write
// path that produces `paymentStatus: 'paid_via_gift'`.
//
// The flip is a single atomic update (status + payment + publishedAt) so an
// owner refreshing their manage page sees "Live" with no in-between state.
// An audit event with the admin's uid and the optional note is written for
// accountability — gifts are revenue the business is deliberately foregoing
// so the trail matters.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { isSuperAdmin } from '@/lib/roles';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import type { UserProfile } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));

    const ip = clientIp(req.headers);
    const rl = await rateLimit(`admin-mark-gift:uid:${uid}:ip:${ip}`, {
      max: 30,
      windowSec: 3600,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const db = adminDb();
    const callerSnap = await db.collection('users').doc(uid).get();
    const caller = callerSnap.exists ? (callerSnap.data() as UserProfile) : null;
    if (!isSuperAdmin(caller)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'memorial id is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';

    const memRef = db.collection('memorials').doc(id);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(memRef);
      if (!snap.exists) return { outcome: 'not_found' as const };
      const memorial = snap.data() as Record<string, unknown>;
      if (memorial.status === 'live') {
        return { outcome: 'already_live' as const };
      }
      tx.update(memRef, {
        status: 'live',
        paymentStatus: 'paid_via_gift',
        publishedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        outcome: 'ok' as const,
        fullName: (memorial.fullName as string) || '',
      };
    });

    if (result.outcome === 'not_found') {
      return NextResponse.json({ error: 'Memorial not found' }, { status: 404 });
    }
    if (result.outcome === 'already_live') {
      return NextResponse.json({ error: 'Memorial is already live.', alreadyLive: true }, { status: 409 });
    }

    await writeAuditAdmin({
      entityType: 'memorial',
      entityId: id,
      action: 'published_via_gift',
      actorUid: uid,
      actorEmail: caller?.email,
      details: note ? { note } : undefined,
    });

    return NextResponse.json({ ok: true, live: true });
  } catch (err: any) {
    console.error('admin/memorials/mark-paid-gift error', err);
    return NextResponse.json(
      { error: 'Could not mark memorial as gift.' },
      { status: 500 },
    );
  }
}
