// Called by the admin partners page after decide() flips status. Sends the
// applicant an "approved" or "rejected" email. Suspensions are internal and
// don't trigger a message here.
//
// Idempotency: we claim decisionEmailSentAt on the application doc inside a
// transaction. If an admin flips approved→suspended→approved we re-send,
// because the claim is also keyed on the current status string.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, verifyIdToken } from '@/lib/firebase-admin';
import {
  sendPartnerApplicationApproved,
  sendPartnerApplicationRejected,
} from '@/lib/sendgrid';
import { isSuperAdmin } from '@/lib/roles';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import type { PartnerApplication, UserProfile } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));

    const ip = clientIp(req.headers);
    const rl = await rateLimit(`admin-partner-notify:ip:${ip}`, {
      max: 60,
      windowSec: 3600,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const db = adminDb();
    const callerSnap = await db.collection('users').doc(uid).get();
    const caller = callerSnap.exists ? (callerSnap.data() as UserProfile) : null;
    if (!isSuperAdmin(caller)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Skip gracefully in environments without a mail provider (typically local
    // dev). The decision itself is already saved by the admin client — only
    // the email delivery is deferred.
    if (!process.env.SENDGRID_API_KEY) {
      console.warn('admin/partners/notify: SENDGRID_API_KEY not set — skipping email');
      return NextResponse.json({ ok: true, skipped: 'sendgrid-not-configured' });
    }

    const { applicationId, decision } = await req.json();
    if (!applicationId || typeof applicationId !== 'string') {
      return NextResponse.json({ error: 'applicationId is required' }, { status: 400 });
    }
    if (decision !== 'approved' && decision !== 'rejected') {
      return NextResponse.json(
        { error: 'decision must be approved or rejected' },
        { status: 400 },
      );
    }

    const appRef = db.collection('partnerApplications').doc(applicationId);
    const appSnap = await appRef.get();
    if (!appSnap.exists) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }
    const app = appSnap.data() as PartnerApplication;
    if (app.status !== decision) {
      return NextResponse.json(
        { error: `Application status is ${app.status}, not ${decision}` },
        { status: 409 },
      );
    }

    const slotKey = `decisionEmailSentAt_${decision}`;
    const claim = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(appRef);
      const data = fresh.data() as Record<string, unknown> | undefined;
      if (data?.[slotKey]) return { outcome: 'already_sent' as const };
      tx.update(appRef, { [slotKey]: FieldValue.serverTimestamp() });
      return { outcome: 'send' as const };
    });

    if (claim.outcome === 'already_sent') {
      return NextResponse.json({ ok: true, skipped: 'already sent' });
    }

    const to = app.applicantEmail;
    if (!to) {
      await appRef.update({ [slotKey]: FieldValue.delete() });
      return NextResponse.json({ ok: true, skipped: 'no email' });
    }

    try {
      if (decision === 'approved') {
        await sendPartnerApplicationApproved(to, {
          contactName: app.contactName,
          businessName: app.businessName,
          partnerType: app.partnerType,
        });
      } else {
        await sendPartnerApplicationRejected(to, {
          contactName: app.contactName,
          businessName: app.businessName,
        });
      }
    } catch (err) {
      await appRef.update({ [slotKey]: FieldValue.delete() });
      throw err;
    }

    return NextResponse.json({ ok: true, sent: true });
  } catch (err: any) {
    console.error('admin/partners/notify error', err);
    return NextResponse.json(
      { error: 'Could not send decision email' },
      { status: 500 },
    );
  }
}
