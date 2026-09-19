// Server-side custody swap. Client rules stop invitees from touching
// memorial.ownerId directly — this route uses admin credentials to complete
// the transfer safely and write an audit event.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const { token, decision } = await req.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }
    if (!['accept', 'decline'].includes(decision)) {
      return NextResponse.json({ error: 'decision must be accept or decline' }, { status: 400 });
    }

    const db = adminDb();
    const user = await adminAuth().getUser(uid);
    const userEmail = (user.email || '').toLowerCase();

    const transferQuery = await db
      .collection('custodyTransfers')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (transferQuery.empty) {
      return NextResponse.json({ error: 'That invitation link is no longer valid.' }, { status: 404 });
    }

    const transferSnap = transferQuery.docs[0];
    const transfer = transferSnap.data();

    if (transfer.status !== 'pending') {
      return NextResponse.json(
        { error: `This invitation has already been ${transfer.status}.` },
        { status: 409 }
      );
    }
    if ((transfer.toEmail || '').toLowerCase() !== userEmail) {
      return NextResponse.json(
        { error: 'This invitation was sent to a different email address.' },
        { status: 403 }
      );
    }

    if (decision === 'decline') {
      await transferSnap.ref.update({
        status: 'declined',
        toUidWhenAccepted: uid,
        respondedAt: FieldValue.serverTimestamp(),
      });
      await writeAuditAdmin({
        entityType: 'custodyTransfer',
        entityId: transferSnap.id,
        action: 'declined',
        actorUid: uid,
        actorEmail: userEmail,
        details: { memorialId: transfer.memorialId },
      });
      return NextResponse.json({ success: true, decision: 'declined' });
    }

    // decision === 'accept'
    const memRef = db.collection('memorials').doc(transfer.memorialId);
    const memSnap = await memRef.get();
    if (!memSnap.exists) {
      return NextResponse.json({ error: 'The memorial no longer exists.' }, { status: 404 });
    }

    const memorial = memSnap.data()!;
    const currentSuccessors: string[] = memorial.successorUids || [];

    if (transfer.nominationType === 'primary') {
      // Swap custody. Previous owner is preserved as first backup so they can
      // still see the memorial in their dashboard.
      const nextSuccessors = [memorial.ownerId, ...currentSuccessors.filter((s) => s !== uid)];
      await memRef.update({
        ownerId: uid,
        successorUids: nextSuccessors,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      // Backup nomination: append to successorUids if not already there.
      if (!currentSuccessors.includes(uid)) {
        await memRef.update({
          successorUids: [...currentSuccessors, uid],
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    await transferSnap.ref.update({
      status: 'accepted',
      toUidWhenAccepted: uid,
      respondedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditAdmin({
      entityType: 'custodyTransfer',
      entityId: transferSnap.id,
      action: 'accepted',
      actorUid: uid,
      actorEmail: userEmail,
      details: {
        memorialId: transfer.memorialId,
        nominationType: transfer.nominationType,
        previousOwnerUid: memorial.ownerId,
      },
    });

    return NextResponse.json({
      success: true,
      decision: 'accepted',
      memorialId: transfer.memorialId,
      nominationType: transfer.nominationType,
    });
  } catch (err: any) {
    console.error('custody accept error:', err);
    return NextResponse.json(
      { error: err.message || 'Something went wrong accepting the invitation.' },
      { status: 500 }
    );
  }
}
