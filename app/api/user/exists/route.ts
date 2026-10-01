import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

// Lightweight existence check used to improve UX on registration/invite
// forms. Firebase's createUserWithEmailAndPassword already surfaces
// "email-already-in-use" on submit, so this adds no new enumeration leak
// beyond what Auth itself exposes. Keeping the endpoint simple and single-
// purpose so a rate-limit/CAPTCHA layer can be added later if needed.
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ exists: false });
    }
    const normalized = email.trim().toLowerCase();
    try {
      await adminAuth().getUserByEmail(normalized);
      return NextResponse.json({ exists: true });
    } catch {
      return NextResponse.json({ exists: false });
    }
  } catch (err: any) {
    console.error('user/exists error', err);
    return NextResponse.json({ exists: false });
  }
}
