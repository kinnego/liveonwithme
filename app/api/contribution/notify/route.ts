// Notify every keeper on a memorial (owner + co-managers) that a new
// contribution is waiting in their inbox. The public memorial page calls
// this fire-and-forget after writing a contribution.
//
// Idempotency: we claim the contribution's notification slot inside a
// transaction before firing any email. A repeat POST (page reload, retry,
// stray fetch) finds notificationSentAt already set and exits without
// emailing again — so a keeper never gets duplicate alerts for one memory.
//
// Rate-limiting: short per-IP bucket as a second line of defence against a
// script spraying contributionIds. The transaction above would catch the
// repeat on any single contribution; the rate limit catches someone
// enumerating many at once.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { sendContributionAlert } from '@/lib/sendgrid';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

async function emailForUid(uid: string): Promise<string | undefined> {
  const db = adminDb();
  try {
    const profile = await db.collection('users').doc(uid).get();
    if (profile.exists) {
      const p = profile.data() as { email?: string };
      if (p.email) return p.email;
    }
  } catch {
    // fall through
  }
  try {
    const authUser = await adminAuth().getUser(uid);
    return authUser.email || undefined;
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req.headers);
    const rl = await rateLimit(`contrib-notify:${ip}`, { max: 60, windowSec: 60 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const { contributionId } = await req.json();
    if (!contributionId || typeof contributionId !== 'string') {
      return NextResponse.json({ error: 'contributionId required' }, { status: 400 });
    }

    const db = adminDb();
    const contribRef = db.collection('contributions').doc(contributionId);

    // Atomic claim: read the contribution, decide whether an email is owed,
    // and mark it claimed in one transaction. Any concurrent retry hits
    // notificationSentAt already set and exits as a no-op.
    const claim = await db.runTransaction(async (tx) => {
      const snap = await tx.get(contribRef);
      if (!snap.exists) {
        return { outcome: 'not_found' as const };
      }
      const data = snap.data() as any;
      if (data.notificationSentAt) {
        return { outcome: 'already_sent' as const };
      }
      // Only alert on fresh public submissions. Keeper-side flows (gallery
      // unpublish, memories page) also write with status pending, but with
      // source=family — don't email keepers about their own actions.
      if (data.status !== 'pending') {
        return { outcome: 'skip', reason: 'not pending' as const, data };
      }
      if (data.source === 'family') {
        return { outcome: 'skip', reason: 'keeper upload' as const, data };
      }

      tx.update(contribRef, {
        notificationSentAt: FieldValue.serverTimestamp(),
      });
      return { outcome: 'send' as const, data };
    });

    if (claim.outcome === 'not_found') {
      return NextResponse.json({ error: 'Contribution not found' }, { status: 404 });
    }
    if (claim.outcome === 'already_sent') {
      return NextResponse.json({ ok: true, skipped: 'already sent' });
    }
    if (claim.outcome === 'skip') {
      return NextResponse.json({ ok: true, skipped: claim.reason });
    }

    const contrib = claim.data;
    const memSnap = await db.collection('memorials').doc(contrib.memorialId).get();
    if (!memSnap.exists) {
      // Roll back the claim so a legitimate retry (if the memorial doc
      // reappears) can still send. In practice this is a data-integrity
      // bug, not something we expect to retry — but no sense permanently
      // suppressing a future dispatch.
      await contribRef.update({ notificationSentAt: FieldValue.delete() });
      return NextResponse.json({ error: 'Memorial not found' }, { status: 404 });
    }
    const memorial = memSnap.data() as any;

    const uids = new Set<string>();
    if (memorial.ownerId) uids.add(memorial.ownerId);
    for (const uid of memorial.coManagerUids || []) uids.add(uid);

    const emails = (
      await Promise.all(Array.from(uids).map(emailForUid))
    ).filter((e): e is string => Boolean(e));

    const isPrivate = contrib.audience === 'family_only';

    await Promise.all(
      emails.map((to) =>
        sendContributionAlert(to, {
          memorialId: contrib.memorialId,
          deceasedFullName: memorial.fullName || 'your loved one',
          contributorName: contrib.contributorName || 'Someone',
          relationship: contrib.relationship || undefined,
          memoryText: contrib.memory || contrib.caption || '',
          hasPhoto: Boolean(contrib.photoPath),
          isPrivate,
        }).catch((err) => {
          console.error('contribution notify send failed', to, err?.message || err);
        }),
      ),
    );

    return NextResponse.json({ ok: true, sent: emails.length });
  } catch (err: any) {
    console.error('contribution/notify error:', err);
    return NextResponse.json(
      { error: 'Could not send notification' },
      { status: 500 },
    );
  }
}
