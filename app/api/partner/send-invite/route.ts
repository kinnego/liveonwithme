import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { sendClaimInvite } from '@/lib/sendgrid';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));

    // Belt + braces: a compromised partner account shouldn't be able to spam
    // bereaved families with invite emails. Cap at 10 per partner per hour
    // and 30 per IP per hour (partners with legit volume won't hit this).
    const ip = clientIp(req.headers);
    const perUser = await rateLimit(`partner-invite:uid:${uid}`, { max: 10, windowSec: 3600 });
    if (!perUser.allowed) {
      return NextResponse.json(
        { error: 'Too many invites. Please try again in a bit.' },
        { status: 429, headers: { 'Retry-After': String(perUser.retryAfterSec) } },
      );
    }
    const perIp = await rateLimit(`partner-invite:ip:${ip}`, { max: 30, windowSec: 3600 });
    if (!perIp.allowed) {
      return NextResponse.json(
        { error: 'Too many invites. Please try again in a bit.' },
        { status: 429, headers: { 'Retry-After': String(perIp.retryAfterSec) } },
      );
    }

    const { referralId } = await req.json();
    if (typeof referralId !== 'string' || !referralId) {
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
    if (referral.wholesalePaymentStatus !== 'paid') {
      return NextResponse.json(
        { error: 'Wholesale must be paid before inviting the family' },
        { status: 400 }
      );
    }
    if (referral.status === 'claimed') {
      return NextResponse.json(
        { error: 'This referral has already been claimed' },
        { status: 400 }
      );
    }

    const token = randomBytes(32).toString('base64url');
    const now = Date.now();

    await db.collection('claimTokens').doc(token).set({
      referralId,
      bereavedEmail: String(referral.bereavedEmail || '').toLowerCase(),
      bereavedName: referral.bereavedName || '',
      deceasedFullName: referral.deceasedFullName || '',
      partnerUid: referral.partnerUid,
      consumed: false,
      createdAt: new Date(now),
      expiresAt: new Date(now + TOKEN_TTL_MS),
    });

    await sendClaimInvite(
      String(referral.bereavedEmail),
      token,
      referralId,
      String(referral.deceasedFullName || ''),
      referral.bereavedName ? String(referral.bereavedName) : undefined
    );

    await refDoc.update({
      lastInvitedAt: new Date(now),
      updatedAt: new Date(now),
    });

    await db.collection('auditEvents').add({
      entityType: 'referral',
      entityId: referralId,
      action: 'invite_sent',
      actorUid: uid,
      createdAt: new Date(now),
      details: { bereavedEmail: referral.bereavedEmail },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('send-invite error', err);
    return NextResponse.json(
      { error: 'Could not send invite' },
      { status: 500 }
    );
  }
}
