// Server-side send of a custody-invite email. The owner has already created
// the custodyTransfer doc client-side; this route is called separately so
// the owner can choose whether to email the invitee or just copy the link.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { sendCustodyInvite } from '@/lib/sendgrid';

export const runtime = 'nodejs';

const RESEND_COOLDOWN_MS = 30 * 1000;

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const { transferId } = await req.json();

    if (!transferId || typeof transferId !== 'string') {
      return NextResponse.json({ error: 'transferId is required' }, { status: 400 });
    }

    const db = adminDb();
    const transferRef = db.collection('custodyTransfers').doc(transferId);
    const transferSnap = await transferRef.get();

    if (!transferSnap.exists) {
      return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });
    }
    const transfer = transferSnap.data()!;

    if (transfer.fromUid !== uid) {
      return NextResponse.json({ error: 'You can only resend your own invitations.' }, { status: 403 });
    }
    if (transfer.status !== 'pending') {
      return NextResponse.json(
        { error: `This invitation has already been ${transfer.status}.` },
        { status: 409 }
      );
    }

    const lastEmailedAt = transfer.lastEmailedAt?.toMillis?.() ?? 0;
    if (lastEmailedAt && Date.now() - lastEmailedAt < RESEND_COOLDOWN_MS) {
      return NextResponse.json(
        { error: 'You just sent this a moment ago — give it a minute and try again.' },
        { status: 429 }
      );
    }

    const memorialSnap = await db.collection('memorials').doc(transfer.memorialId).get();
    if (!memorialSnap.exists) {
      return NextResponse.json({ error: 'The memorial no longer exists.' }, { status: 404 });
    }
    const memorial = memorialSnap.data()!;

    const inviter = await adminAuth().getUser(uid);

    await sendCustodyInvite(
      transfer.toEmail,
      transfer.token,
      memorial.fullName || 'this memorial',
      inviter.displayName || undefined,
      transfer.nominationType,
    );

    await transferRef.update({
      lastEmailedAt: FieldValue.serverTimestamp(),
      emailSendCount: FieldValue.increment(1),
    });

    await writeAuditAdmin({
      entityType: 'custodyTransfer',
      entityId: transferSnap.id,
      action: 'invite_emailed',
      actorUid: uid,
      actorEmail: inviter.email || undefined,
      details: {
        memorialId: transfer.memorialId,
        toEmail: transfer.toEmail,
        nominationType: transfer.nominationType,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('custody send-invite error:', err);
    return NextResponse.json(
      { error: err.message || 'Something went wrong sending the invitation email.' },
      { status: 500 }
    );
  }
}
