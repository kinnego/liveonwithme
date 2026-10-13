// Visitor-filed report against a contribution on a public memorial. Open
// to the public (no sign-in required) because the reporter is often a
// bystander who stumbled across something off; forcing a login would mean
// most reports never land.
//
// Rate limited hard per IP so a bad actor can't drown the admin inbox.
// After the write we fire the admin notice via SendGrid — best-effort,
// SendGrid failures don't fail the report submission.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { sendContributionReportAdmin } from '@/lib/sendgrid';

export const runtime = 'nodejs';

const MAX_REASON_LENGTH = 2000;

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req.headers);
    const rl = await rateLimit(`contrib-report:ip:${ip}`, {
      max: 5,
      windowSec: 3600,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error:
            'You have reported several items recently. Please try again later.',
        },
        {
          status: 429,
          headers: { 'Retry-After': String(rl.retryAfterSec) },
        },
      );
    }

    const body = await req.json().catch(() => ({}));
    const memorialId = String(body?.memorialId || '').trim();
    const contributionId = String(body?.contributionId || '').trim();
    const reason = String(body?.reason || '').trim().slice(0, MAX_REASON_LENGTH);
    const reporterEmailRaw = String(body?.reporterEmail || '').trim().toLowerCase();

    if (!memorialId || !contributionId || !reason) {
      return NextResponse.json(
        { error: 'A reason is required.' },
        { status: 400 },
      );
    }

    const db = adminDb();

    const [memSnap, contribSnap] = await Promise.all([
      db.collection('memorials').doc(memorialId).get(),
      db.collection('contributions').doc(contributionId).get(),
    ]);

    if (!memSnap.exists || !contribSnap.exists) {
      return NextResponse.json(
        { error: 'That memory could not be found.' },
        { status: 404 },
      );
    }

    const memorial = memSnap.data() as {
      fullName?: string;
      slug?: string;
      status?: string;
      offline?: boolean;
      visibility?: string;
    };
    const contribution = contribSnap.data() as { memorialId?: string };
    if (contribution.memorialId !== memorialId) {
      return NextResponse.json(
        { error: 'Memory does not belong to this memorial.' },
        { status: 400 },
      );
    }

    // If an Authorization header is present we tag the report with the
    // reporter's uid. Signed-in reports jump to the top of the admin inbox
    // because the identifier gives us a trail to follow up with.
    let reporterUid: string | undefined;
    const authHeader = req.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const decoded = await adminAuth().verifyIdToken(
          authHeader.slice('Bearer '.length),
        );
        reporterUid = decoded.uid;
      } catch {
        // Ignore invalid tokens — treat as anonymous.
      }
    }

    const reporterEmail = reporterEmailRaw.includes('@')
      ? reporterEmailRaw
      : undefined;

    const payload: Record<string, unknown> = {
      memorialId,
      contributionId,
      reason,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
    };
    if (reporterEmail) payload.reporterEmail = reporterEmail;
    if (reporterUid) payload.reporterUid = reporterUid;

    const ref = await db.collection('contributionReports').add(payload);

    try {
      await sendContributionReportAdmin({
        reportId: ref.id,
        memorialId,
        memorialName: memorial.fullName || 'A memorial',
        memorialSlug: memorial.slug,
        contributionId,
        reason,
        reporterEmail,
        reporterUid,
      });
    } catch (emailErr) {
      console.error('contribution-report email failed', emailErr);
    }

    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err: any) {
    console.error('contribution/report error', err);
    return NextResponse.json(
      { error: 'Could not file the report. Please try again later.' },
      { status: 500 },
    );
  }
}
