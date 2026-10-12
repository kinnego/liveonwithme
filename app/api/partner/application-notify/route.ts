// Fires the "we got your application" email to the applicant and the admin
// inbox notice. Called by the client immediately after it addDoc's a
// partnerApplication, so the applicant's uid matches a known doc.
//
// Idempotency: we claim a slot on partnerApplications/{id} by setting
// receivedEmailSentAt. A duplicate submit (double-click, retry) finds the
// field and no-ops. Errors roll the slot back so a retry can land.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, verifyIdToken } from '@/lib/firebase-admin';
import {
  sendPartnerApplicationReceived,
  sendPartnerApplicationAdminNotice,
} from '@/lib/sendgrid';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import type { PartnerApplication } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));

    const ip = clientIp(req.headers);
    const rl = await rateLimit(`partner-apply-notify:ip:${ip}`, {
      max: 20,
      windowSec: 3600,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const { applicationId } = await req.json();
    if (!applicationId || typeof applicationId !== 'string') {
      return NextResponse.json({ error: 'applicationId is required' }, { status: 400 });
    }

    const db = adminDb();
    const appRef = db.collection('partnerApplications').doc(applicationId);
    const appSnap = await appRef.get();
    if (!appSnap.exists) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }
    const app = appSnap.data() as PartnerApplication;
    if (app.applicantUid !== uid) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const claim = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(appRef);
      const data = fresh.data() as (PartnerApplication & { receivedEmailSentAt?: unknown }) | undefined;
      if (data?.receivedEmailSentAt) return { outcome: 'already_sent' as const };
      tx.update(appRef, { receivedEmailSentAt: FieldValue.serverTimestamp() });
      return { outcome: 'send' as const };
    });

    if (claim.outcome === 'already_sent') {
      return NextResponse.json({ ok: true, skipped: 'already sent' });
    }

    const authUser = await adminAuth().getUser(uid);
    const to = app.applicantEmail || authUser.email || '';

    try {
      if (to) {
        await sendPartnerApplicationReceived(to, {
          contactName: app.contactName,
          businessName: app.businessName,
          partnerType: app.partnerType,
        });
      }
      await sendPartnerApplicationAdminNotice({
        applicationId,
        applicantEmail: to,
        contactName: app.contactName,
        contactPhone: app.contactPhone,
        website: app.website,
        businessName: app.businessName,
        partnerType: app.partnerType,
        notes: app.notes,
      });
    } catch (err) {
      await appRef.update({ receivedEmailSentAt: FieldValue.delete() });
      throw err;
    }

    return NextResponse.json({ ok: true, sent: true });
  } catch (err: any) {
    console.error('partner/application-notify error', err);
    return NextResponse.json(
      { error: 'Could not send application email' },
      { status: 500 },
    );
  }
}
