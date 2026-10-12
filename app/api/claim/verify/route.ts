import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { slugify } from '@/lib/ids';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { sendFamilyClaimedReferral } from '@/lib/sendgrid';

export const runtime = 'nodejs';

// Validates a one-time claim token and provisions the memorial end-to-end on
// the server using the admin SDK — this is the only path that can tag a
// memorial `paid_via_partner`, which gates free publishing. The token is
// atomically consumed inside a transaction so a race between two tabs can't
// both succeed. Returns a Firebase custom token the browser trades for a
// session via signInWithCustomToken.
export async function POST(req: NextRequest) {
  try {
    // Per-IP cap: claim tokens are 32 random bytes so blind guessing isn't
    // viable, but a brute-force attempt would show up as a flood from a
    // single IP. Legitimate users click once; 30/hour has lots of headroom.
    const ip = clientIp(req.headers);
    const rl = await rateLimit(`claim-verify:ip:${ip}`, { max: 30, windowSec: 3600 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const { token } = await req.json();
    if (typeof token !== 'string' || !token) {
      return NextResponse.json({ error: 'Missing token.' }, { status: 400 });
    }

    const db = adminDb();
    const tokenRef = db.collection('claimTokens').doc(token);
    const tokenSnap = await tokenRef.get();
    if (!tokenSnap.exists) {
      return NextResponse.json(
        { error: 'This invite link is invalid or has already been used. Please contact the person who sent it to you for a new invite.' },
        { status: 400 }
      );
    }

    const tokenData = tokenSnap.data()!;
    const expiresAt = tokenData.expiresAt?.toMillis?.() ?? 0;
    if (tokenData.consumed) {
      // If the same user is retrying after a transient failure (same uid in
      // the token record), let them continue — their memorial already exists
      // from the first run and we just need to hand back a fresh custom token
      // so they can sign in.
      if (tokenData.consumedByUid && tokenData.memorialSlug) {
        const customToken = await adminAuth().createCustomToken(tokenData.consumedByUid);
        return NextResponse.json({
          customToken,
          memorialSlug: tokenData.memorialSlug,
          needsPasswordSetup: !!tokenData.needsPasswordSetup,
          resumed: true,
        });
      }
      return NextResponse.json(
        { error: 'This invite link has already been used. If this wasn\'t you, contact the person who sent it to you.' },
        { status: 400 }
      );
    }
    if (Date.now() > expiresAt) {
      return NextResponse.json(
        { error: 'This invite link has expired. Please contact the person who sent it to you for a new invite.' },
        { status: 400 }
      );
    }

    const email = String(tokenData.bereavedEmail || '').toLowerCase();
    const referralId = String(tokenData.referralId || '');
    if (!email || !referralId) {
      return NextResponse.json({ error: 'Invite is incomplete.' }, { status: 400 });
    }

    // Must have a real, paid, unclaimed referral behind this invite — this is
    // the server-authoritative gate for the paid_via_partner path. Without
    // this check, anyone could POST a stale token after the partner's
    // wholesale payment was refunded or never completed.
    const refRef = db.collection('referrals').doc(referralId);
    const refSnap = await refRef.get();
    if (!refSnap.exists) {
      return NextResponse.json({ error: 'This invite link is no longer valid.' }, { status: 400 });
    }
    const referral = refSnap.data()!;
    if (referral.wholesalePaymentStatus !== 'paid') {
      return NextResponse.json(
        { error: 'This invite isn\'t ready yet — the partner still needs to complete payment. Please contact them.' },
        { status: 400 }
      );
    }
    if (referral.status === 'claimed') {
      return NextResponse.json(
        { error: 'This memorial has already been claimed.' },
        { status: 400 }
      );
    }

    const auth = adminAuth();
    let uid: string;
    let isNewUser = false;
    try {
      const existing = await auth.getUserByEmail(email);
      uid = existing.uid;
    } catch (err: any) {
      // Only treat the specific user-not-found error as a signal to create;
      // other Auth errors (quota, network, invalid key) should surface as
      // failures, not silently create duplicate accounts.
      if (err?.code === 'auth/user-not-found') {
        const created = await auth.createUser({
          email,
          emailVerified: true,
          displayName: tokenData.bereavedName || undefined,
        });
        uid = created.uid;
        isNewUser = true;
      } else {
        throw err;
      }
    }

    // Allocate a slug. We suffix with a random nonce to avoid collisions when
    // two memorials for people with the same name are claimed around the same
    // time; the admin SDK bypasses rules so we don't need slug uniqueness in
    // the ruleset itself.
    const baseSlug = slugify(String(referral.deceasedFullName || 'memorial'));
    let slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const existingMem = await db.collection('memorials').doc(slug).get();
      if (!existingMem.exists) break;
      slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;
    }

    // Create the Person (admin SDK — bypasses the Firestore rule that would
    // require signedIn()). This mirrors what lib/person.ts does client-side.
    const personRef = db.collection('persons').doc();
    const personId = personRef.id;

    // Atomic claim: inside the transaction we re-check the token hasn't been
    // consumed by a parallel request, re-check the referral is still paid +
    // unclaimed, then do all the writes together. If any check fails, the
    // transaction aborts and the token remains available for a legitimate
    // retry.
    await db.runTransaction(async (tx) => {
      const freshTok = await tx.get(tokenRef);
      if (!freshTok.exists) throw new Error('Token vanished mid-claim.');
      const t = freshTok.data()!;
      if (t.consumed) throw new Error('ALREADY_CONSUMED');

      const freshRef = await tx.get(refRef);
      if (!freshRef.exists) throw new Error('Referral vanished mid-claim.');
      const r = freshRef.data()!;
      if (r.wholesalePaymentStatus !== 'paid') throw new Error('REF_NOT_PAID');
      if (r.status === 'claimed') throw new Error('REF_ALREADY_CLAIMED');

      tx.set(personRef, {
        fullName: referral.deceasedFullName,
        born: referral.deceasedBorn || '',
        died: referral.deceasedDied || '',
        isLiving: !referral.deceasedDied,
        createdByUid: uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection('memorials').doc(slug), {
        ownerId: uid,
        createdByUid: uid,
        personId,
        plotId: null,
        successorUids: [],
        coManagerUids: [],
        slug,
        fullName: referral.deceasedFullName,
        fullNameLower: String(referral.deceasedFullName || '').toLowerCase(),
        nickname: referral.deceasedNickname || '',
        shortName: referral.deceasedShortName || '',
        address: referral.deceasedAddress || '',
        born: referral.deceasedBorn || '',
        died: referral.deceasedDied || '',
        kind: referral.deceasedDied ? 'memorial' : 'legacy',
        epitaph: '',
        story: '',
        visibility: 'public',
        heroPhotoPath: '',
        status: 'draft',
        // Only this server path sets paid_via_partner. Client rules block it.
        paymentStatus: 'paid_via_partner',
        salesChannel: 'partner',
        partnerUid: referral.partnerUid || referral.funeralDirectorUid || null,
        referralId,
        publishedAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.update(refRef, {
        status: 'claimed',
        claimedByUid: uid,
        memorialId: slug,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Ensure a user profile exists so client reads of users/{uid} succeed
      // immediately after sign-in. If one already exists, don't clobber it.
      const userRef = db.collection('users').doc(uid);
      tx.set(
        userRef,
        {
          uid,
          email,
          role: 'family',
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.update(tokenRef, {
        consumed: true,
        consumedAt: FieldValue.serverTimestamp(),
        consumedByUid: uid,
        memorialSlug: slug,
        needsPasswordSetup: isNewUser,
      });
    });

    await writeAuditAdmin({
      entityType: 'memorial',
      entityId: slug,
      action: 'claimed_from_partner_referral',
      actorUid: uid,
      actorEmail: email,
      details: {
        referralId,
        partnerUid: referral.partnerUid || referral.funeralDirectorUid || null,
      },
    });

    // Tell the partner the family took over. Non-fatal — the claim is
    // already committed and the family's sign-in must not be gated on
    // SendGrid availability.
    const partnerUid = (referral.partnerUid || referral.funeralDirectorUid) as string | undefined;
    if (partnerUid) {
      try {
        const partnerAuth = await auth.getUser(partnerUid).catch(() => null);
        const partnerProfSnap = await db.collection('users').doc(partnerUid).get();
        const partnerProf = partnerProfSnap.data() as
          | { displayName?: string; email?: string }
          | undefined;
        const to = partnerAuth?.email || partnerProf?.email || '';
        if (to) {
          await sendFamilyClaimedReferral(to, {
            contactName: partnerAuth?.displayName || partnerProf?.displayName,
            deceasedFullName: referral.deceasedFullName || 'the family',
            bereavedName: referral.bereavedName,
            referralId,
          });
        }
      } catch (emailErr) {
        console.error('family-claimed-referral email failed', emailErr);
      }
    }

    const customToken = await auth.createCustomToken(uid);
    return NextResponse.json({
      customToken,
      memorialSlug: slug,
      needsPasswordSetup: isNewUser,
    });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg === 'ALREADY_CONSUMED') {
      return NextResponse.json(
        { error: 'This invite link has already been used.' },
        { status: 400 }
      );
    }
    if (msg === 'REF_NOT_PAID') {
      return NextResponse.json(
        { error: 'This invite isn\'t ready yet — the partner still needs to complete payment.' },
        { status: 400 }
      );
    }
    if (msg === 'REF_ALREADY_CLAIMED') {
      return NextResponse.json(
        { error: 'This memorial has already been claimed.' },
        { status: 400 }
      );
    }
    console.error('claim/verify error', err);
    return NextResponse.json(
      { error: 'Could not verify this invite link.' },
      { status: 500 }
    );
  }
}
