// Generate (or regenerate) the one-time claim code for a self-managed
// memorial. The plaintext code is returned exactly once and never persisted;
// we store only its SHA-256 hash plus a 5-character hint so the owner can
// recognise which code is active.
//
// Owner-only, legacy-only. Regenerating a code silently invalidates the
// previous one — anyone holding a copy of the old letter can no longer
// claim with it.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { generateLegacyCode, hashLegacyCode } from '@/lib/legacy-code-server';
import { hintFromCode } from '@/lib/legacy-code';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const { memorialId } = await req.json();

    if (!memorialId || typeof memorialId !== 'string') {
      return NextResponse.json({ error: 'memorialId is required' }, { status: 400 });
    }

    const db = adminDb();
    const memRef = db.collection('memorials').doc(memorialId);
    const memSnap = await memRef.get();
    if (!memSnap.exists) {
      return NextResponse.json({ error: 'Memorial not found.' }, { status: 404 });
    }
    const m = memSnap.data()!;

    if (m.ownerId !== uid) {
      return NextResponse.json(
        { error: 'Only the owner can generate a claim code.' },
        { status: 403 }
      );
    }
    if (m.kind !== 'legacy') {
      return NextResponse.json(
        { error: 'Claim codes are only for pages you set up for yourself.' },
        { status: 400 }
      );
    }

    const code = generateLegacyCode();
    const user = await adminAuth().getUser(uid);
    const regenerated = !!m.legacyClaimCodeHash;

    await memRef.update({
      legacyClaimCodeHash: hashLegacyCode(code),
      legacyClaimCodeHint: hintFromCode(code),
      legacyClaimCodeSetAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditAdmin({
      entityType: 'memorial',
      entityId: memorialId,
      action: regenerated ? 'legacy_claim_code_regenerated' : 'legacy_claim_code_generated',
      actorUid: uid,
      actorEmail: user.email || undefined,
    });

    return NextResponse.json({ success: true, code });
  } catch (err: any) {
    console.error('legacy generate-code error:', err);
    return NextResponse.json(
      { error: err.message || 'Something went wrong generating the claim code.' },
      { status: 500 }
    );
  }
}
