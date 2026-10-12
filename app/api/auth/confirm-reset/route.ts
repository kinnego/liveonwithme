// Consume a password-reset token and set the user's new password.
//
// Atomicity: the "consume" step runs inside a transaction so a concurrent
// retry can't both pass the `!data.consumed` check and both update the
// password. Only one request wins; the second sees `consumed: true` on its
// re-read and exits with the invalid-link error.
//
// Rate-limiting: per-IP bucket on top of the token lookup to blunt brute
// force. The token is 32 random bytes of base64url (~256 bits) so blind
// guessing isn't realistic, but the rate limit catches a stolen link being
// hammered to beat the one-hour expiry.

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req.headers);
    const rl = await rateLimit(`auth-confirm-reset:ip:${ip}`, { max: 20, windowSec: 3600 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const { token, password } = await req.json();

    if (typeof token !== 'string' || !token) {
      return NextResponse.json({ error: 'Missing token.' }, { status: 400 });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return NextResponse.json(
        { error: 'Please use a password of at least 6 characters.' },
        { status: 400 }
      );
    }

    const db = adminDb();
    const ref = db.collection('passwordResetTokens').doc(token);

    const claim = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        return { outcome: 'invalid' as const };
      }
      const data = snap.data()!;
      if (data.consumed) {
        return { outcome: 'already_used' as const };
      }
      const expiresAt = data.expiresAt?.toMillis?.() ?? 0;
      if (Date.now() > expiresAt) {
        return { outcome: 'expired' as const };
      }
      tx.update(ref, {
        consumed: true,
        consumedAt: new Date(),
      });
      return { outcome: 'ok' as const, uid: data.uid as string, email: data.email as string };
    });

    if (claim.outcome === 'invalid') {
      return NextResponse.json(
        { error: 'This link is invalid or has already been used. Please request a new one.' },
        { status: 400 }
      );
    }
    if (claim.outcome === 'already_used') {
      return NextResponse.json(
        { error: 'This link has already been used. Please request a new one.' },
        { status: 400 }
      );
    }
    if (claim.outcome === 'expired') {
      return NextResponse.json(
        { error: 'This link has expired. Please request a new one.' },
        { status: 400 }
      );
    }

    try {
      await adminAuth().updateUser(claim.uid, { password });
    } catch (err) {
      // The token has already been marked consumed; roll it back so the user
      // can retry with a fresh request-reset. Otherwise a transient Auth
      // error would permanently burn their only link.
      await ref.update({ consumed: false, consumedAt: null });
      throw err;
    }

    return NextResponse.json({ ok: true, email: claim.email });
  } catch (err: any) {
    console.error('confirm-reset error', err);
    return NextResponse.json(
      { error: 'Could not update your password. Please try again.' },
      { status: 500 }
    );
  }
}
