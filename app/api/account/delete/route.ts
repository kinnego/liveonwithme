// GDPR Article 17 — right to erasure.
//
// Flow:
//   1. Hard rate-limit (destructive; also deters a stolen session being used
//      to nuke an account before the user notices).
//   2. Caller must POST confirmEmail that matches the Auth record exactly.
//      This is the last client-side guard before anything is purged.
//   3. For each memorial the user owns:
//        a. If a successor is set → promote first successor to owner.
//        b. Else if a co-manager is set → promote first co-manager.
//        c. Else → mark offline + pendingDeletionAt = now + 30d so a nightly
//           sweep can purge if nobody claims. Super admin can restore within
//           the window via support.
//   4. Remove uid from coManagerUids/successorUids on any memorial where it
//      still appears (co-manager seats + backup nominations elsewhere).
//   5. Scrub contributions this user made on other memorials — PII fields
//      (contributorName/Email) are wiped but the memory text itself stays,
//      because the memory belongs to the memorial's family, not the
//      contributor.
//   6. Delete partnerApplications and successionRequests belonging to the
//      user (PII-heavy, no third-party interest).
//   7. Cancel any pending custodyTransfers from or to the user.
//   8. Delete users/{uid}.
//   9. Send a confirmation email with the orphan list (best-effort — if the
//      email fails we still return success, logs will carry the diagnostic).
//  10. Delete the Firebase Auth account.
//  11. Audit event.
//
// Super admins can't delete themselves through this path — losing the
// bootstrap admin would brick the console. They can be removed by another
// super admin (or via Firebase console) if genuinely needed.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { sendAccountDeletedConfirmation } from '@/lib/sendgrid';
import { isSuperAdmin } from '@/lib/roles';
import type { UserProfile } from '@/lib/types';

export const runtime = 'nodejs';

const SOFT_DELETE_DAYS = 30;

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));

    const ip = clientIp(req.headers);
    const rlIp = await rateLimit(`account-delete:ip:${ip}`, {
      max: 5,
      windowSec: 3600,
    });
    if (!rlIp.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rlIp.retryAfterSec) } },
      );
    }
    const rlUid = await rateLimit(`account-delete:uid:${uid}`, {
      max: 3,
      windowSec: 3600,
    });
    if (!rlUid.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rlUid.retryAfterSec) } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const confirmEmail = String(body?.confirmEmail || '').trim().toLowerCase();
    if (!confirmEmail) {
      return NextResponse.json(
        { error: 'confirmEmail is required' },
        { status: 400 },
      );
    }

    const auth = adminAuth();
    const authUser = await auth.getUser(uid);
    const authEmail = (authUser.email || '').toLowerCase();
    if (!authEmail || authEmail !== confirmEmail) {
      return NextResponse.json(
        { error: 'The email you typed does not match your account.' },
        { status: 400 },
      );
    }

    const db = adminDb();
    const profSnap = await db.collection('users').doc(uid).get();
    const profile = profSnap.exists ? (profSnap.data() as UserProfile) : null;
    if (isSuperAdmin(profile)) {
      return NextResponse.json(
        {
          error:
            'Super admin accounts cannot be removed through this flow. Contact another administrator.',
        },
        { status: 403 },
      );
    }

    const now = Date.now();
    const restoreDeadline = new Date(now + SOFT_DELETE_DAYS * 86400_000);

    // ─── Memorials I own ───────────────────────────────────────────────────
    const ownedSnap = await db
      .collection('memorials')
      .where('ownerId', '==', uid)
      .get();

    const orphaned: Array<{ fullName: string; restoreDeadline: string }> = [];
    let promoted = 0;

    for (const docSnap of ownedSnap.docs) {
      const m = docSnap.data() as {
        fullName?: string;
        successorUids?: string[];
        coManagerUids?: string[];
      };
      const successors = (m.successorUids || []).filter((s) => s !== uid);
      const coManagers = (m.coManagerUids || []).filter((c) => c !== uid);

      if (successors.length > 0) {
        const nextOwner = successors[0];
        await docSnap.ref.update({
          ownerId: nextOwner,
          successorUids: successors.slice(1),
          coManagerUids: coManagers.filter((c) => c !== nextOwner),
          updatedAt: FieldValue.serverTimestamp(),
        });
        promoted++;
      } else if (coManagers.length > 0) {
        const nextOwner = coManagers[0];
        await docSnap.ref.update({
          ownerId: nextOwner,
          coManagerUids: coManagers.slice(1),
          successorUids: successors,
          updatedAt: FieldValue.serverTimestamp(),
        });
        promoted++;
      } else {
        await docSnap.ref.update({
          offline: true,
          pendingDeletionAt: restoreDeadline,
          pendingDeletionReason: 'owner_deleted_account',
          updatedAt: FieldValue.serverTimestamp(),
        });
        orphaned.push({
          fullName: m.fullName || 'A memorial',
          restoreDeadline: restoreDeadline.toLocaleDateString('en-IE', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
        });
      }
    }

    // ─── Memorials where I'm a co-manager (not owner) ──────────────────────
    const coManagerSnap = await db
      .collection('memorials')
      .where('coManagerUids', 'array-contains', uid)
      .get();
    for (const docSnap of coManagerSnap.docs) {
      const m = docSnap.data() as { coManagerUids?: string[]; ownerId?: string };
      if (m.ownerId === uid) continue; // handled above
      await docSnap.ref.update({
        coManagerUids: (m.coManagerUids || []).filter((c) => c !== uid),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // ─── Memorials where I'm a successor (not owner) ───────────────────────
    const successorSnap = await db
      .collection('memorials')
      .where('successorUids', 'array-contains', uid)
      .get();
    for (const docSnap of successorSnap.docs) {
      const m = docSnap.data() as { successorUids?: string[]; ownerId?: string };
      if (m.ownerId === uid) continue;
      await docSnap.ref.update({
        successorUids: (m.successorUids || []).filter((s) => s !== uid),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // ─── Contributions I made (keyed on email — we don't store contributor
    // uid). Scrub the PII, keep the memory text for the memorial's family.
    if (authEmail) {
      const contribSnap = await db
        .collection('contributions')
        .where('contributorEmail', '==', authEmail)
        .get();
      for (const docSnap of contribSnap.docs) {
        await docSnap.ref.update({
          contributorName: 'Someone who loved them',
          contributorEmail: FieldValue.delete(),
          relationship: FieldValue.delete(),
        });
      }
    }

    // ─── Partner applications (contains PII: name, phone, website) ─────────
    const appSnap = await db
      .collection('partnerApplications')
      .where('applicantUid', '==', uid)
      .get();
    for (const docSnap of appSnap.docs) {
      await docSnap.ref.delete();
    }

    // ─── Succession requests I submitted (contains phone + relationship) ───
    const succSnap = await db
      .collection('successionRequests')
      .where('requesterUid', '==', uid)
      .get();
    for (const docSnap of succSnap.docs) {
      await docSnap.ref.delete();
    }

    // ─── Pending custody transfers I sent ──────────────────────────────────
    const fromSnap = await db
      .collection('custodyTransfers')
      .where('fromUid', '==', uid)
      .where('status', '==', 'pending')
      .get();
    for (const docSnap of fromSnap.docs) {
      await docSnap.ref.update({
        status: 'cancelled',
        respondedAt: FieldValue.serverTimestamp(),
      });
    }

    // ─── Pending custody transfers sent to me ──────────────────────────────
    if (authEmail) {
      const toSnap = await db
        .collection('custodyTransfers')
        .where('toEmail', '==', authEmail)
        .where('status', '==', 'pending')
        .get();
      for (const docSnap of toSnap.docs) {
        await docSnap.ref.update({
          status: 'cancelled',
          respondedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // ─── Delete the user profile ───────────────────────────────────────────
    if (profSnap.exists) {
      await profSnap.ref.delete();
    }

    // ─── Audit (before Auth deletion so actorUid is still resolvable) ─────
    await writeAuditAdmin({
      entityType: 'user',
      entityId: uid,
      action: 'account_deleted_gdpr',
      actorUid: uid,
      actorEmail: authEmail,
      details: {
        memorialsPromoted: promoted,
        memorialsOrphaned: orphaned.length,
      },
    });

    // ─── Confirmation email (best-effort; log and continue) ────────────────
    if (authEmail) {
      try {
        await sendAccountDeletedConfirmation(authEmail, {
          recipientName: authUser.displayName || undefined,
          orphanedMemorials: orphaned,
        });
      } catch (emailErr) {
        console.error('account-deletion email failed', emailErr);
      }
    }

    // ─── Delete the Auth user last. After this call, the caller's session
    // token can no longer refresh. The client must call signOut() right after
    // a 200 response.
    await auth.deleteUser(uid);

    return NextResponse.json({
      ok: true,
      promoted,
      orphaned: orphaned.length,
    });
  } catch (err: any) {
    console.error('account/delete error', err);
    return NextResponse.json(
      { error: 'Could not delete the account. Please try again later.' },
      { status: 500 },
    );
  }
}
