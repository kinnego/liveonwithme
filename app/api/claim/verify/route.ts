import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

// Validates a one-time claim token, provisions a Firebase user for the
// bereaved email if one doesn't exist, and returns a custom auth token the
// browser can trade for a session via signInWithCustomToken.
export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();
    if (typeof token !== 'string' || !token) {
      return NextResponse.json({ error: 'Missing token.' }, { status: 400 });
    }

    const db = adminDb();
    const ref = db.collection('claimTokens').doc(token);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json(
        { error: 'This invite link is invalid or has already been used. Please contact the person who sent it to you for a new invite.' },
        { status: 400 }
      );
    }

    const data = snap.data()!;
    const expiresAt = data.expiresAt?.toMillis?.() ?? 0;
    if (data.consumed) {
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

    const email = String(data.bereavedEmail || '').toLowerCase();
    if (!email) {
      return NextResponse.json({ error: 'Invite is missing an email address.' }, { status: 400 });
    }

    const auth = adminAuth();
    let uid: string;
    try {
      const existing = await auth.getUserByEmail(email);
      uid = existing.uid;
    } catch {
      // No existing account — create a passwordless user. The claim flow asks
      // them to choose a password immediately after, which links a password
      // provider onto this uid.
      const created = await auth.createUser({
        email,
        emailVerified: true,
        displayName: data.bereavedName || undefined,
      });
      uid = created.uid;
    }

    const customToken = await auth.createCustomToken(uid);

    // Mark the token as consumed BEFORE returning so a stolen/forwarded link
    // can't be replayed. If the client fails to sign in after this, the user
    // can request a new invite.
    await ref.update({
      consumed: true,
      consumedAt: new Date(),
      consumedByUid: uid,
    });

    return NextResponse.json({
      customToken,
      referralId: data.referralId,
      email,
    });
  } catch (err: any) {
    console.error('claim/verify error', err);
    return NextResponse.json(
      { error: 'Could not verify this invite link.' },
      { status: 500 }
    );
  }
}
