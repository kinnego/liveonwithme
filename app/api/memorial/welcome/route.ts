// Fires once per user: a welcome email on their first memorial create, with
// a bookmark-friendly link back to the manage page so a grieving user who
// drifts away can find their work again weeks later.
//
// Idempotency: we claim the slot inside a transaction on users/{uid}. A
// pre-existing welcomeSentAt field means we've already sent — any second,
// third, etc. memorial create is a no-op (we don't want to spam the user
// every time they add a page).

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { sendMemorialWelcome } from '@/lib/sendgrid';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));

    const ip = clientIp(req.headers);
    const rl = await rateLimit(`memorial-welcome:ip:${ip}`, { max: 20, windowSec: 3600 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

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
    if (memorial.ownerId !== uid) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const userRef = db.collection('users').doc(uid);

    const claim = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const existing = snap.exists ? snap.data() : null;
      if (existing?.welcomeSentAt) {
        return { outcome: 'already_sent' as const };
      }
      tx.set(
        userRef,
        {
          welcomeSentAt: FieldValue.serverTimestamp(),
          welcomeMemorialId: memorialId,
        },
        { merge: true },
      );
      return { outcome: 'send' as const };
    });

    if (claim.outcome === 'already_sent') {
      return NextResponse.json({ ok: true, skipped: 'already sent' });
    }

    const authUser = await adminAuth().getUser(uid);
    const to = authUser.email;
    if (!to) {
      // No email on the account (e.g. phone-only auth, which we don't use,
      // but defensively): don't fail the request — the memorial still
      // exists. Roll back the slot so a future email backfill can send.
      await userRef.update({
        welcomeSentAt: FieldValue.delete(),
        welcomeMemorialId: FieldValue.delete(),
      });
      return NextResponse.json({ ok: true, skipped: 'no email' });
    }

    try {
      await sendMemorialWelcome(to, {
        memorialSlug: memorialId,
        deceasedFullName: memorial.fullName || 'your loved one',
        kind: memorial.kind === 'legacy' ? 'legacy' : 'memorial',
        recipientName: authUser.displayName || undefined,
      });
    } catch (err) {
      // Roll back so a retry can land. We'd rather deliver a late welcome
      // than permanently suppress it due to a transient SendGrid blip.
      await userRef.update({
        welcomeSentAt: FieldValue.delete(),
        welcomeMemorialId: FieldValue.delete(),
      });
      throw err;
    }

    return NextResponse.json({ ok: true, sent: true });
  } catch (err: any) {
    console.error('memorial/welcome error', err);
    return NextResponse.json({ error: 'Could not send welcome email' }, { status: 500 });
  }
}
