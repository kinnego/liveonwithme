import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getStripe, STRIPE_WEBHOOK_SECRET } from '@/lib/stripe';

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

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const memorialId = session.metadata?.memorialId || session.client_reference_id;
        const customerId = session.metadata?.customerId;

        if (!memorialId) {
          console.warn('Webhook: missing memorialId', session.id);
          break;
        }

        // Idempotency: check if payment already recorded as succeeded
        const paymentsSnap = await db
          .collection('payments')
          .where('providerPaymentId', '==', session.id)
          .limit(1)
          .get();

        if (!paymentsSnap.empty) {
          const paymentDoc = paymentsSnap.docs[0];
          if (paymentDoc.data().status === 'succeeded') {
            return NextResponse.json({ received: true, alreadyProcessed: true });
          }
          await paymentDoc.ref.update({
            status: 'succeeded',
            paidAt: FieldValue.serverTimestamp(),
          });
        } else {
          // Create payment record if it wasn't pre-created
          await db.collection('payments').add({
            memorialId,
            customerId,
            amount: session.amount_total,
            currency: session.currency,
            status: 'succeeded',
            provider: 'stripe',
            providerPaymentId: session.id,
            salesChannel: 'direct',
            createdAt: FieldValue.serverTimestamp(),
            paidAt: FieldValue.serverTimestamp(),
          });
        }

        // Mark memorial as live
        await db.collection('memorials').doc(memorialId).update({
          status: 'live',
          paymentStatus: 'paid',
          publishedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        break;
      }

      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object as any;
        const memorialId = session.metadata?.memorialId || session.client_reference_id;

        if (memorialId) {
          // Revert memorial to draft so customer can try again
          await db.collection('memorials').doc(memorialId).update({
            status: 'draft',
            updatedAt: FieldValue.serverTimestamp(),
          });

          const paymentsSnap = await db
            .collection('payments')
            .where('providerPaymentId', '==', session.id)
            .limit(1)
            .get();

          if (!paymentsSnap.empty) {
            await paymentsSnap.docs[0].ref.update({ status: 'failed' });
          }
        }
        break;
      }

      default:
        // Ignore unhandled events
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('Webhook handler error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
