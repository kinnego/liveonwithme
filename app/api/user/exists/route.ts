import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Lightweight existence check used to improve UX on registration/invite
// forms. Firebase's createUserWithEmailAndPassword already surfaces
// "email-already-in-use" on submit, so this adds no new enumeration leak
// beyond what Auth itself exposes. Still rate-limited per IP so a bulk
// enumeration attempt — "sweep every address in a known-breached list to
// see which ones have accounts here" — hits a hard ceiling long before it
// becomes a usable signal.
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req.headers);
    const rl = await rateLimit(`user-exists:ip:${ip}`, {
      max: 30,
      windowSec: 300,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { exists: false },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

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
