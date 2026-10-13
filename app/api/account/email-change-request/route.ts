// A thin notification route: the actual email change is driven by Firebase
// Auth's `verifyBeforeUpdateEmail` on the client, which sends the verifying
// link to the NEW address. This endpoint fires an additional notice to the
// OLD address so the current owner has a trail they can act on if the
// request was fraudulent.
//
// The user does not need recent sign-in to hit this endpoint — Firebase's
// own verifyBeforeUpdateEmail call enforces that on the client, so by the
// time we're here the recent-login check has already passed on the user's
// own device. If this is called without the Firebase side having fired, the
// worst case is a notice email about a change that didn't happen — which
// is fine, the recipient will see nothing in their new inbox.

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { sendEmailChangeNotice } from '@/lib/sendgrid';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header' },
        { status: 401 },
      );
    }
    const decoded = await adminAuth().verifyIdToken(
      authHeader.slice('Bearer '.length),
    );
    const uid = decoded.uid;

    const ip = clientIp(req.headers);
    const rl = await rateLimit(`email-change:uid:${uid}:ip:${ip}`, {
      max: 5,
      windowSec: 3600,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rl.retryAfterSec) },
        },
      );
    }

    const body = await req.json().catch(() => ({}));
    const newEmail = String(body?.newEmail || '').trim().toLowerCase();
    if (!newEmail || !newEmail.includes('@')) {
      return NextResponse.json(
        { error: 'A valid new email address is required.' },
        { status: 400 },
      );
    }

    const authUser = await adminAuth().getUser(uid);
    const oldEmail = (authUser.email || '').toLowerCase();
    if (!oldEmail) {
      // No current email on file (shouldn't happen for password + Google
      // signups, but defend against it). No one to notify, so just succeed.
      return NextResponse.json({ ok: true, notified: false });
    }

    try {
      await sendEmailChangeNotice(oldEmail, {
        newEmail,
        recipientName: authUser.displayName || undefined,
      });
    } catch (emailErr) {
      console.error('email-change-notice send failed', emailErr);
      return NextResponse.json(
        { ok: true, notified: false },
        { status: 200 },
      );
    }

    return NextResponse.json({ ok: true, notified: true });
  } catch (err: any) {
    console.error('account/email-change-request error', err);
    return NextResponse.json(
      { error: 'Could not send the notice. Please try again later.' },
      { status: 500 },
    );
  }
}
