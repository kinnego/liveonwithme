import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { sendPasswordResetEmail } from '@/lib/sendgrid';

export const runtime = 'nodejs';

const TOKEN_TTL_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

// Always returns 200 (with a generic body) so an attacker can't enumerate
// which emails have accounts by watching status codes or response bodies.
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ ok: true });
    }
    const normalized = email.trim().toLowerCase();

    let uid: string;
    try {
      const user = await adminAuth().getUserByEmail(normalized);
      uid = user.uid;
    } catch {
      return NextResponse.json({ ok: true });
    }

    const db = adminDb();
    const now = Date.now();

    // Anti-spam: if any token was minted for this uid in the last minute,
    // skip. Done with a single-field query (auto-indexed) + in-memory check
    // so we don't need a composite Firestore index.
    const recent = await db
      .collection('passwordResetTokens')
      .where('uid', '==', uid)
      .limit(5)
      .get();

    const cooldownHit = recent.docs.some((d) => {
      const created = d.data().createdAt?.toMillis?.() ?? 0;
      return now - created < RESEND_COOLDOWN_MS;
    });
    if (cooldownHit) {
      return NextResponse.json({ ok: true });
    }

    const token = randomBytes(32).toString('base64url');

    await db.collection('passwordResetTokens').doc(token).set({
      uid,
      email: normalized,
      consumed: false,
      createdAt: new Date(now),
      expiresAt: new Date(now + TOKEN_TTL_MS),
    });

    await sendPasswordResetEmail(normalized, token);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('request-reset error', err);
    return NextResponse.json({ ok: true });
  }
}
