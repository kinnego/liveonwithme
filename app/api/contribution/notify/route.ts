// Notify every keeper on a memorial (owner + co-managers) that a new
// contribution is waiting in their inbox. The public memorial page calls
// this fire-and-forget after writing a contribution; we read the doc back
// from Firestore to confirm it exists before dispatching email, so an
// unauthenticated POST can't be used to spam arbitrary addresses.

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { sendContributionAlert } from '@/lib/sendgrid';

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
    const { contributionId } = await req.json();
    if (!contributionId || typeof contributionId !== 'string') {
      return NextResponse.json({ error: 'contributionId required' }, { status: 400 });
    }

    const db = adminDb();
    const contribSnap = await db.collection('contributions').doc(contributionId).get();
    if (!contribSnap.exists) {
      return NextResponse.json({ error: 'Contribution not found' }, { status: 404 });
    }
    const contrib = contribSnap.data() as any;

    // Only alert on fresh public submissions. Keeper-side flows (unpublish
    // from gallery) also write with status pending but carry source=family
    // — don't email the keeper about their own action.
    if (contrib.status !== 'pending') {
      return NextResponse.json({ ok: true, skipped: 'not pending' });
    }
    if (contrib.source === 'family') {
      return NextResponse.json({ ok: true, skipped: 'keeper upload' });
    }

    const memSnap = await db.collection('memorials').doc(contrib.memorialId).get();
    if (!memSnap.exists) {
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
      { error: err.message || 'Could not send notification' },
      { status: 500 },
    );
  }
}
