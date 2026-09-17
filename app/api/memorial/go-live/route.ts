import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { getStripe, siteUrl } from '@/lib/stripe';
import { MEMORIAL_PRICE_EUR } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const { memorialId } = await req.json();

    if (!memorialId || typeof memorialId !== 'string') {
      return NextResponse.json({ error: 'memorialId is required' }, { status: 400 });
    }

    const db = adminDb();
    const memRef = db.collection('memorials').doc(memorialId);
    const snap = await memRef.get();

    if (!snap.exists) {
      return NextResponse.json({ error: 'Memorial not found' }, { status: 404 });
    }

    const memorial = snap.data()!;

    if (memorial.ownerId !== uid) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    if (memorial.status === 'live') {
      return NextResponse.json({ error: 'Memorial is already live', alreadyLive: true }, { status: 200 });
    }

    // Path 1: Funeral director already paid → publish immediately
    if (memorial.paymentStatus === 'paid_via_funeral_director') {
      await memRef.update({
        status: 'live',
        publishedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Update referral commercialStatus to 'live'
      if (memorial.referralId) {
        await db.collection('referrals').doc(memorial.referralId).update({
          commercialStatus: 'live',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return NextResponse.json({ success: true, live: true });
    }

    // Path 2: Direct customer → create Stripe checkout session
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: MEMORIAL_PRICE_EUR * 100,
            product_data: {
              name: `Memorial for ${memorial.fullName}`,
              description: 'Lifetime hosting for a LiveOnWith.me memorial.',
            },
          },
          quantity: 1,
        },
      ],
      client_reference_id: memorialId,
      metadata: {
        memorialId,
        customerId: uid,
        salesChannel: 'direct',
      },
      success_url: `${siteUrl()}/memorial/${memorialId}/manage?paid=1`,
      cancel_url: `${siteUrl()}/memorial/${memorialId}/manage?cancelled=1`,
    });

    // Mark memorial as awaiting_payment and record pending payment
    await memRef.update({
      status: 'awaiting_payment',
      updatedAt: FieldValue.serverTimestamp(),
    });

    await db.collection('payments').add({
      memorialId,
      customerId: uid,
      amount: MEMORIAL_PRICE_EUR * 100,
      currency: 'eur',
      status: 'pending',
      provider: 'stripe',
      providerPaymentId: session.id,
      salesChannel: 'direct',
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, checkoutUrl: session.url });
  } catch (err: any) {
    console.error('go-live error:', err);
    return NextResponse.json(
      { error: err.message || 'Could not initiate Go Live' },
      { status: 500 }
    );
  }
}
