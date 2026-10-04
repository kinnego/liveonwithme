// Claim a self-managed page using the owner's printed one-time code. On a
// valid match this route moves custody immediately — the previous owner is
// preserved as the first successor (same pattern as a primary custody
// transfer), the code is burned, and the page's `kind` flips from 'legacy'
// to 'memorial' because the person it's about is no longer alive to curate
// their own page.
//
// There is intentionally no verification step: the code is the gate, and
// the owner is expected to guard it carefully (printed letter, will, safe).

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { hashLegacyCode } from '@/lib/legacy-code-server';
import { normalizeLegacyCode } from '@/lib/legacy-code';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const { code } = await req.json();

    const canonical = normalizeLegacyCode(code || '');
    if (!canonical || canonical.length < 16) {
      return NextResponse.json(
        { error: 'Please enter the full claim code from the letter.' },
        { status: 400 }
      );
    }

    const db = adminDb();
    const hash = hashLegacyCode(canonical);
    const matches = await db
      .collection('memorials')
      .where('legacyClaimCodeHash', '==', hash)
      .limit(1)
      .get();

    if (matches.empty) {
      return NextResponse.json(
        { error: "We couldn't match that code to a page. Check for typos and try again." },
        { status: 404 }
      );
    }

    const memRef = matches.docs[0].ref;
    const user = await adminAuth().getUser(uid);

    // Transaction prevents a race if two people enter the same code at once:
    // the second attempt sees the already-flipped kind and bails out cleanly.
    const result = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(memRef);
      if (!fresh.exists) {
        return { error: 'The page no longer exists.' as const, status: 404 };
      }
      const m = fresh.data()!;

      if (m.legacyClaimCodeHash !== hash) {
        return { error: 'That code is no longer valid.' as const, status: 409 };
      }
      if (m.kind !== 'legacy') {
        return {
          error: 'This page is already in family hands and can no longer be claimed with a code.' as const,
          status: 409,
        };
      }
      if (m.ownerId === uid) {
        return { error: 'You already own this page.' as const, status: 400 };
      }

      const previousOwnerUid: string = m.ownerId;
      const currentSuccessors: string[] = m.successorUids || [];
      const currentCoManagers: string[] = m.coManagerUids || [];

      // Preserve the previous owner as the primary successor so their
      // dashboard still shows the page (useful in cases where custody is
      // being handed down before death). Drop the claimant from the
      // successor/co-manager lists — they're the owner now.
      const nextSuccessors = previousOwnerUid
        ? [previousOwnerUid, ...currentSuccessors.filter((s) => s !== uid && s !== previousOwnerUid)]
        : currentSuccessors.filter((s) => s !== uid);

      tx.update(memRef, {
        ownerId: uid,
        successorUids: nextSuccessors,
        coManagerUids: currentCoManagers.filter((c) => c !== uid),
        kind: 'memorial',
        legacyClaimCodeHash: FieldValue.delete(),
        legacyClaimCodeHint: FieldValue.delete(),
        legacyClaimCodeSetAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        success: true as const,
        previousOwnerUid,
        slug: m.slug,
        fullName: m.fullName || '',
      };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await writeAuditAdmin({
      entityType: 'memorial',
      entityId: memRef.id,
      action: 'legacy_claimed',
      actorUid: uid,
      actorEmail: user.email || undefined,
      details: { previousOwnerUid: result.previousOwnerUid, memorialId: memRef.id },
    });

    return NextResponse.json({
      success: true,
      memorialId: memRef.id,
      slug: result.slug,
      fullName: result.fullName,
    });
  } catch (err: any) {
    console.error('legacy claim error:', err);
    return NextResponse.json(
      { error: err.message || 'Something went wrong claiming this page.' },
      { status: 500 }
    );
  }
}
