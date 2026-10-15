// Stripe webhook receiver.
//
// Idempotency: Stripe retries deliveries on 5xx or timeout, so we must make
// each event safe to replay. We use event.id — guaranteed unique per logical
// event — as the primary dedup key, atomically claimed inside a transaction.
// A repeat delivery for the same event.id finds the ledger entry and exits
// as a no-op before any state mutation runs.
//
// Verification: before applying state we re-read the memorial/referral and
// confirm the session's amount + currency match the payment record we wrote
// at checkout time. This catches two classes of bug: a forged event that
// slipped past signature verification somehow, and a client/metadata mix-up
// where the session points at the wrong entity.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getStripe, STRIPE_WEBHOOK_SECRET } from '@/lib/stripe';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { sendWholesaleReceipt, sendMemorialPaymentReceipt } from '@/lib/sendgrid';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }
  if (!STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const body = await req.text();
  const stripe = getStripe();

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 400 });
  }

  const db = adminDb();

  // Atomic event.id claim. We write the ledger row inside the transaction so
  // a second delivery of the same event lands on the existing doc and exits
  // without re-running the handler. Only events we actually care about are
  // ledgered — background noise types just return 200.
  const INTERESTING = new Set([
    'checkout.session.completed',
    'checkout.session.expired',
    'checkout.session.async_payment_failed',
  ]);
  if (!INTERESTING.has(event.type)) {
    return NextResponse.json({ received: true });
  }

  const ledgerRef = db.collection('processedStripeEvents').doc(event.id);
  const claim = await db.runTransaction(async (tx) => {
    const existing = await tx.get(ledgerRef);
    if (existing.exists) {
      return { fresh: false as const };
    }
    tx.set(ledgerRef, {
      type: event.type,
      receivedAt: FieldValue.serverTimestamp(),
    });
    return { fresh: true as const };
  });

  if (!claim.fresh) {
    return NextResponse.json({ received: true, alreadyProcessed: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const memorialId = session.metadata?.memorialId || session.client_reference_id;
        const customerId = session.metadata?.customerId;
        const paymentKind: string = session.metadata?.paymentKind || 'direct_memorial';
        const referralId: string | undefined = session.metadata?.referralId;

        // Reconcile against the payment row we wrote at checkout. If amount
        // or currency diverges we refuse to apply state — the client might
        // have been tampered with, or this session doesn't belong to us.
        const paymentsSnap = await db
          .collection('payments')
          .where('providerPaymentId', '==', session.id)
          .limit(1)
          .get();

        if (paymentsSnap.empty) {
          // No pre-created payment row — fall back to recording the event
          // but don't mutate downstream state. Alerts via log.
          console.warn('stripe webhook: no payment row for session', session.id);
          await db.collection('payments').add({
            memorialId: memorialId || null,
            referralId: referralId || null,
            customerId,
            kind: paymentKind,
            amount: session.amount_total,
            currency: session.currency,
            status: 'orphaned',
            provider: 'stripe',
            providerPaymentId: session.id,
            salesChannel: paymentKind === 'partner_wholesale' ? 'partner' : 'direct',
            createdAt: FieldValue.serverTimestamp(),
            paidAt: FieldValue.serverTimestamp(),
          });
          return NextResponse.json({ received: true, orphaned: true });
        }

        const paymentDoc = paymentsSnap.docs[0];
        const payment = paymentDoc.data();

        if (payment.status === 'succeeded') {
          // Belt-and-braces: the event.id ledger should have caught this,
          // but if two different events reference the same session we
          // still don't want to double-apply.
          return NextResponse.json({ received: true, alreadyProcessed: true });
        }

        // Reconcile against the quoted price, not the final total. A
        // legitimately applied Stripe promotion code reduces amount_total
        // below amount_subtotal; the subtotal is what we quoted at Go
        // Live and is the right ground truth for "did the customer get
        // charged the right base price?". The discount itself is held by
        // Stripe and can be audited there.
        const quotedBase =
          typeof session.amount_subtotal === 'number'
            ? session.amount_subtotal
            : session.amount_total;
        if (
          typeof payment.amount === 'number' &&
          typeof quotedBase === 'number' &&
          payment.amount !== quotedBase
        ) {
          console.error('stripe webhook: amount mismatch', {
            session: session.id,
            expected: payment.amount,
            got: quotedBase,
            amountTotal: session.amount_total,
          });
          await paymentDoc.ref.update({
            status: 'rejected_amount_mismatch',
            rejectedAt: FieldValue.serverTimestamp(),
          });
          return NextResponse.json({ received: true, rejected: 'amount_mismatch' });
        }
        if (
          payment.currency &&
          session.currency &&
          String(payment.currency).toLowerCase() !== String(session.currency).toLowerCase()
        ) {
          console.error('stripe webhook: currency mismatch', session.id);
          await paymentDoc.ref.update({
            status: 'rejected_currency_mismatch',
            rejectedAt: FieldValue.serverTimestamp(),
          });
          return NextResponse.json({ received: true, rejected: 'currency_mismatch' });
        }

        await paymentDoc.ref.update({
          status: 'succeeded',
          paidAt: FieldValue.serverTimestamp(),
        });

        if (paymentKind === 'partner_wholesale' && referralId) {
          await db.collection('referrals').doc(referralId).update({
            wholesalePaymentStatus: 'paid',
            wholesalePaymentId: session.id,
            updatedAt: FieldValue.serverTimestamp(),
          });
          await writeAuditAdmin({
            entityType: 'referral',
            entityId: referralId,
            action: 'wholesale_paid',
            actorUid: customerId || 'stripe',
            details: { session: session.id, amount: session.amount_total },
          });

          // Partner receipt. Email failure must not fail the webhook —
          // the payment and referral state are already committed.
          try {
            const refSnap = await db.collection('referrals').doc(referralId).get();
            const ref = refSnap.data();
            const partnerUid = ref?.partnerUid as string | undefined;
            if (partnerUid) {
              const partnerAuth = await adminAuth().getUser(partnerUid).catch(() => null);
              const partnerProfSnap = await db.collection('users').doc(partnerUid).get();
              const partnerProf = partnerProfSnap.data() as
                | { displayName?: string; email?: string }
                | undefined;
              const to = partnerAuth?.email || partnerProf?.email || '';
              if (to) {
                await sendWholesaleReceipt(to, {
                  contactName: partnerAuth?.displayName || partnerProf?.displayName,
                  amountMinor: session.amount_total || 0,
                  currency: session.currency || 'eur',
                  deceasedFullName: ref?.deceasedFullName || 'the family',
                  bereavedName: ref?.bereavedName,
                  referralId,
                  sessionId: session.id,
                });
              }
            }
          } catch (emailErr) {
            console.error('wholesale receipt email failed', emailErr);
          }
        } else if (memorialId) {
          await db.collection('memorials').doc(memorialId).update({
            status: 'live',
            paymentStatus: 'paid',
            publishedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          await writeAuditAdmin({
            entityType: 'memorial',
            entityId: memorialId,
            action: 'published_direct_paid',
            actorUid: customerId || 'stripe',
            details: { session: session.id, amount: session.amount_total },
          });

          // Memorial-owner receipt. Non-fatal if it fails.
          try {
            const memSnap = await db.collection('memorials').doc(memorialId).get();
            const memorial = memSnap.data();
            const ownerUid = memorial?.ownerId as string | undefined;
            if (ownerUid) {
              const ownerAuth = await adminAuth().getUser(ownerUid).catch(() => null);
              const ownerProfSnap = await db.collection('users').doc(ownerUid).get();
              const ownerProf = ownerProfSnap.data() as
                | { displayName?: string; email?: string }
                | undefined;
              const to = ownerAuth?.email || ownerProf?.email || '';
              if (to) {
                await sendMemorialPaymentReceipt(to, {
                  recipientName: ownerAuth?.displayName || ownerProf?.displayName,
                  amountMinor: session.amount_total || 0,
                  currency: session.currency || 'eur',
                  deceasedFullName: memorial?.fullName || 'your loved one',
                  memorialSlug: memorial?.slug || memorialId,
                  sessionId: session.id,
                });
              }
            }
          } catch (emailErr) {
            console.error('memorial receipt email failed', emailErr);
          }
        }

        break;
      }

      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object as any;
        const memorialId = session.metadata?.memorialId || session.client_reference_id;
        const paymentKind: string = session.metadata?.paymentKind || 'direct_memorial';

        if (memorialId && paymentKind === 'direct_memorial') {
          await db.collection('memorials').doc(memorialId).update({
            status: 'draft',
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        const paymentsSnap = await db
          .collection('payments')
          .where('providerPaymentId', '==', session.id)
          .limit(1)
          .get();

        if (!paymentsSnap.empty) {
          await paymentsSnap.docs[0].ref.update({ status: 'failed' });
        }
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('Webhook handler error:', err);
    // Roll back the ledger claim so Stripe's retry can reach us. Otherwise
    // the next delivery would short-circuit on the ledger and we'd silently
    // drop a legitimate payment.
    try {
      await ledgerRef.delete();
    } catch {
      // best effort — if we can't delete, Stripe retries will no-op; manual
      // reconciliation needed.
    }
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
