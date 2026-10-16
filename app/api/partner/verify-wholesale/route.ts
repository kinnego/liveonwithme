import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { getStripe } from '@/lib/stripe';
import { readPricingAdmin } from '@/lib/config-admin';

export const runtime = 'nodejs';

// Backstop for the Stripe webhook: on demand, verifies the latest pending
// wholesale checkout session with Stripe and flips the referral to paid if
// Stripe says so. Needed in local dev (where the webhook can't reach
// localhost without `stripe listen`) and as a last-resort self-service fix if
// a webhook event is ever missed in production.
//
// Idempotent: a paid referral short-circuits, and the payment doc update is
// gated on current status being 'pending' so a late webhook won't double-write.
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const { referralId } = await req.json();
    if (!referralId || typeof referralId !== 'string') {
      return NextResponse.json({ error: 'referralId is required' }, { status: 400 });
    }

    const db = adminDb();

    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 });
    }
    const user = userSnap.data()!;
    const isSuperAdmin = user.role === 'super_admin';
    const isApprovedPartner = user.role === 'partner' && user.partnerStatus === 'approved';
    if (!isSuperAdmin && !isApprovedPartner) {
      return NextResponse.json({ error: 'Partner access required' }, { status: 403 });
    }

    const refDoc = db.collection('referrals').doc(referralId);
    const refSnap = await refDoc.get();
    if (!refSnap.exists) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }
    const referral = refSnap.data()!;
    if (referral.partnerUid !== uid && !isSuperAdmin) {
      return NextResponse.json({ error: 'Not your referral' }, { status: 403 });
    }
    if (referral.wholesalePaymentStatus === 'paid') {
      return NextResponse.json({ status: 'paid' });
    }

    const pendingSnap = await db
      .collection('payments')
      .where('referralId', '==', referralId)
      .where('status', '==', 'pending')
      .where('provider', '==', 'stripe')
      .limit(5)
      .get();

    if (pendingSnap.empty) {
      return NextResponse.json({ status: 'no_session' });
    }

    const stripe = getStripe();
    const pricing = await readPricingAdmin();

    for (const doc of pendingSnap.docs) {
      const pending = doc.data();
      const sessionId: string | undefined = pending.providerPaymentId;
      if (!sessionId) continue;

      let session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>;
      try {
        session = await stripe.checkout.sessions.retrieve(sessionId);
      } catch (err: any) {
        console.warn('verify-wholesale: session retrieve failed', sessionId, err?.message);
        continue;
      }

      if (session.payment_status !== 'paid') {
        if (session.status && session.status !== 'open') {
          await doc.ref.update({ status: 'expired' });
        }
        continue;
      }

      // Mirror the webhook's amount/currency guard — never trust a stale or
      // tampered session. Compare against amount_subtotal (the quoted base
      // price) rather than amount_total so that legitimately applied Stripe
      // promotion codes don't trip the mismatch check.
      const quotedBase =
        typeof session.amount_subtotal === 'number'
          ? session.amount_subtotal
          : session.amount_total;
      if (
        typeof quotedBase === 'number' &&
        quotedBase !== pricing.partnerWholesalePriceCents
      ) {
        console.error('verify-wholesale: amount mismatch', sessionId);
        await doc.ref.update({
          status: 'rejected_amount_mismatch',
          rejectedAt: FieldValue.serverTimestamp(),
        });
        continue;
      }
      if (
        session.currency &&
        String(session.currency).toLowerCase() !== String(pricing.currency).toLowerCase()
      ) {
        console.error('verify-wholesale: currency mismatch', sessionId);
        await doc.ref.update({
          status: 'rejected_currency_mismatch',
          rejectedAt: FieldValue.serverTimestamp(),
        });
        continue;
      }

      // Transactional idempotency: only flip pending → succeeded. If the
      // webhook already handled this session we leave it alone.
      await db.runTransaction(async (tx) => {
        const freshPayment = await tx.get(doc.ref);
        if (freshPayment.data()?.status !== 'pending') return;
        tx.update(doc.ref, {
          status: 'succeeded',
          paidAt: FieldValue.serverTimestamp(),
        });

        const freshRef = await tx.get(refDoc);
        if (freshRef.data()?.wholesalePaymentStatus !== 'paid') {
          tx.update(refDoc, {
            wholesalePaymentStatus: 'paid',
            wholesalePaymentId: session.id,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });

      return NextResponse.json({ status: 'paid' });
    }

    return NextResponse.json({ status: 'pending' });
  } catch (err: any) {
    console.error('verify-wholesale error', err);
    return NextResponse.json({ error: 'Could not verify payment' }, { status: 500 });
  }
}
