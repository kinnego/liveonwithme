import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
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
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json(
        { error: 'This link is invalid or has already been used. Please request a new one.' },
        { status: 400 }
      );
    }

    const data = snap.data()!;
    const expiresAt = data.expiresAt?.toMillis?.() ?? 0;
    if (data.consumed) {
      return NextResponse.json(
        { error: 'This link has already been used. Please request a new one.' },
        { status: 400 }
      );
    }
    if (Date.now() > expiresAt) {
      return NextResponse.json(
        { error: 'This link has expired. Please request a new one.' },
        { status: 400 }
      );
    }

    await adminAuth().updateUser(data.uid, { password });

    await ref.update({
      consumed: true,
      consumedAt: new Date(),
    });

    return NextResponse.json({ ok: true, email: data.email });
  } catch (err: any) {
    console.error('confirm-reset error', err);
    return NextResponse.json(
      { error: 'Could not update your password. Please try again.' },
      { status: 500 }
    );
  }
}
