import { NextRequest, NextResponse } from 'next/server';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { getStripe, siteUrl } from '@/lib/stripe';
import { readPricingAdmin } from '@/lib/config-admin';

export const runtime = 'nodejs';

// Creates a Stripe checkout session for a partner's €150 wholesale purchase
// against a specific referral. The webhook flips the referral to paid.
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const { referralId } = await req.json();
    if (!referralId || typeof referralId !== 'string') {
      return NextResponse.json({ error: 'referralId is required' }, { status: 400 });
    }

    const db = adminDb();

    // Verify the caller is an approved partner.
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
      return NextResponse.json({ error: 'Already paid', alreadyPaid: true }, { status: 200 });
    }

    const pricing = await readPricingAdmin();
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: pricing.currency,
            unit_amount: pricing.partnerWholesalePriceCents,
            product_data: {
              name: `Wholesale memorial: ${referral.deceasedFullName}`,
              description:
                'Live On With Me wholesale price for a partner-created memorial. Bill your customer separately.',
            },
          },
          quantity: 1,
        },
      ],
      client_reference_id: referralId,
      metadata: {
        referralId,
        customerId: uid,
        salesChannel: 'partner',
        paymentKind: 'partner_wholesale',
      },
      success_url: `${siteUrl()}/partner/referrals/${referralId}?paid=1`,
      cancel_url: `${siteUrl()}/partner/referrals/${referralId}?cancelled=1`,
    });

    await db.collection('payments').add({
      referralId,
      customerId: uid,
      kind: 'partner_wholesale',
      amount: pricing.partnerWholesalePriceCents,
      currency: pricing.currency,
      status: 'pending',
      provider: 'stripe',
      providerPaymentId: session.id,
      salesChannel: 'partner',
      createdAt: new Date(),
    });

    return NextResponse.json({ checkoutUrl: session.url });
  } catch (err: any) {
    console.error('wholesale-checkout error', err);
    return NextResponse.json({ error: err.message || 'Checkout failed' }, { status: 500 });
  }
}
