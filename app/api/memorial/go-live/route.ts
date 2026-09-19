import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { getStripe, siteUrl } from '@/lib/stripe';
import { readPricingAdmin } from '@/lib/config-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';

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

    // Partner-paid path: partner has already paid wholesale — publish free.
    if (memorial.paymentStatus === 'paid_via_partner' || memorial.paymentStatus === 'paid_via_funeral_director') {
      await memRef.update({
        status: 'live',
        paymentStatus: 'paid_via_partner',
        publishedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      await writeAuditAdmin({
        entityType: 'memorial',
        entityId: memorialId,
        action: 'published_via_partner',
        actorUid: uid,
        details: { referralId: memorial.referralId || null },
      });

      return NextResponse.json({ success: true, live: true });
    }

    // Direct customer path: create Stripe checkout for the direct price.
    const pricing = await readPricingAdmin();
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: pricing.currency,
            unit_amount: pricing.directPriceCents,
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
        paymentKind: 'direct_memorial',
      },
      success_url: `${siteUrl()}/memorial/${memorialId}/manage?paid=1`,
      cancel_url: `${siteUrl()}/memorial/${memorialId}/manage?cancelled=1`,
    });

    await memRef.update({
      status: 'awaiting_payment',
      updatedAt: FieldValue.serverTimestamp(),
    });

    await db.collection('payments').add({
      memorialId,
      customerId: uid,
      kind: 'direct_memorial',
      amount: pricing.directPriceCents,
      currency: pricing.currency,
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
