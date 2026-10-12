import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { getStripe, siteUrl } from '@/lib/stripe';
import { readPricingAdmin } from '@/lib/config-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { isSecondaryOnPlot } from '@/lib/pricing-admin';

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
    // Defence in depth: even though the only path that can tag a memorial
    // `paid_via_partner` is the admin-SDK claim route, re-verify the
    // referral record here so a bug or data migration elsewhere can't let a
    // forged tag publish for free. We check: referral exists, wholesale is
    // paid, the referral is claimed by this user, and it points at this
    // memorial.
    if (memorial.paymentStatus === 'paid_via_partner' || memorial.paymentStatus === 'paid_via_funeral_director') {
      const referralId = memorial.referralId;
      if (!referralId || typeof referralId !== 'string') {
        return NextResponse.json(
          { error: 'This memorial is missing its partner referral. Please contact support.' },
          { status: 400 }
        );
      }
      const refSnap = await db.collection('referrals').doc(referralId).get();
      if (!refSnap.exists) {
        return NextResponse.json(
          { error: 'The partner referral behind this memorial is missing. Please contact support.' },
          { status: 400 }
        );
      }
      const referral = refSnap.data()!;
      if (referral.wholesalePaymentStatus !== 'paid') {
        return NextResponse.json(
          { error: 'The partner hasn\'t completed payment yet. Please contact them to publish this memorial.' },
          { status: 400 }
        );
      }
      if (referral.memorialId !== memorialId || referral.claimedByUid !== uid) {
        return NextResponse.json(
          { error: 'This memorial doesn\'t match its partner referral. Please contact support.' },
          { status: 400 }
        );
      }

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
        details: { referralId },
      });

      return NextResponse.json({ success: true, live: true });
    }

    // Direct customer path: create Stripe checkout for the direct price.
    // If this memorial is joining a plot that already has a paid, live
    // memorial, the plot QR is already engraved and we charge the secondary
    // price instead of the full price.
    const pricing = await readPricingAdmin();
    const secondary =
      !!memorial.plotId && (await isSecondaryOnPlot(memorialId, memorial.plotId));
    const amount = secondary
      ? pricing.secondaryDirectPriceCents
      : pricing.directPriceCents;
    const paymentKind = secondary ? 'secondary_memorial' : 'direct_memorial';

    const stripe = getStripe();

    // Idempotent checkout: if a session for this memorial is already open
    // and valid, hand the user back to it instead of minting a new one.
    // Prevents double-charging when the user hits "Go Live" twice (slow
    // network, impatient click) and makes replays via retry safe.
    const pendingSnap = await db
      .collection('payments')
      .where('memorialId', '==', memorialId)
      .where('status', '==', 'pending')
      .where('provider', '==', 'stripe')
      .limit(5)
      .get();

    for (const doc of pendingSnap.docs) {
      const existing = doc.data();
      const existingSessionId: string | undefined = existing.providerPaymentId;
      if (!existingSessionId) continue;
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(existingSessionId);
        if (
          existingSession.status === 'open' &&
          existingSession.url &&
          existingSession.amount_total === amount
        ) {
          return NextResponse.json({ success: true, checkoutUrl: existingSession.url });
        }
        // Session no longer usable — mark the stale row so the next list
        // scan is short.
        if (existingSession.status && existingSession.status !== 'open') {
          await doc.ref.update({ status: 'expired' });
        }
      } catch (err) {
        // Session not found on Stripe (e.g. deleted test data). Treat as
        // stale and continue.
        console.warn('stripe session retrieve failed', existingSessionId, (err as any)?.message);
        await doc.ref.update({ status: 'expired' });
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: pricing.currency,
            unit_amount: amount,
            product_data: {
              name: `Memorial for ${memorial.fullName}`,
              description: secondary
                ? 'Adding a name to an existing plot on LiveOnWith.me — lifetime hosting.'
                : 'Lifetime hosting for a LiveOnWith.me memorial.',
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
        paymentKind,
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
      kind: paymentKind,
      amount,
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
      { error: 'Could not initiate Go Live' },
      { status: 500 }
    );
  }
}
