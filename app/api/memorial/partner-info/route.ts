// Returns the partner (funeral director / stonemason / etc.) who originally
// set up a memorial, if any. The family owns the memorial after they claim it,
// but may want to contact the partner about the service, headstone, etc.
// Firestore rules don't let clients read other users' profile docs or partner
// applications, so the manage page calls this with its own auth token.

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb, verifyIdToken } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const callerUid = await verifyIdToken(req.headers.get('Authorization'));
    const { memorialId } = await req.json();

    if (!memorialId || typeof memorialId !== 'string') {
      return NextResponse.json({ error: 'memorialId is required' }, { status: 400 });
    }

    const db = adminDb();
    const memSnap = await db.collection('memorials').doc(memorialId).get();
    if (!memSnap.exists) {
      return NextResponse.json({ error: 'Memorial not found' }, { status: 404 });
    }

    const memorial = memSnap.data()!;
    const coManagerUids: string[] = memorial.coManagerUids || [];
    const isOwner = memorial.ownerId === callerUid;
    const isCoManager = coManagerUids.includes(callerUid);
    if (!isOwner && !isCoManager) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const partnerUid: string | null = memorial.partnerUid || null;
    if (!partnerUid) {
      return NextResponse.json({ partner: null });
    }

    let displayName: string | undefined;
    let email: string | undefined;
    let partnerType: string | undefined;
    let partnerApplicationId: string | undefined;

    const profileSnap = await db.collection('users').doc(partnerUid).get();
    if (profileSnap.exists) {
      const p = profileSnap.data() as {
        email?: string;
        displayName?: string;
        partnerType?: string;
        partnerApplicationId?: string;
      };
      email = p.email;
      displayName = p.displayName;
      partnerType = p.partnerType;
      partnerApplicationId = p.partnerApplicationId;
    }
    if (!email) {
      try {
        const authUser = await adminAuth().getUser(partnerUid);
        email = authUser.email || undefined;
        if (!displayName) displayName = authUser.displayName || undefined;
      } catch {
        /* partner account may have been deleted — leave undefined */
      }
    }

    let businessName: string | undefined;
    let contactName: string | undefined;
    let contactPhone: string | undefined;
    let website: string | undefined;
    if (partnerApplicationId) {
      try {
        const appSnap = await db
          .collection('partnerApplications')
          .doc(partnerApplicationId)
          .get();
        if (appSnap.exists) {
          const a = appSnap.data() as {
            businessName?: string;
            contactName?: string;
            contactPhone?: string;
            website?: string;
          };
          businessName = a.businessName;
          contactName = a.contactName;
          contactPhone = a.contactPhone;
          website = a.website;
        }
      } catch {
        /* best-effort — card still renders with name/email */
      }
    }

    return NextResponse.json({
      partner: {
        uid: partnerUid,
        displayName,
        email,
        partnerType,
        businessName,
        contactName,
        contactPhone,
        website,
      },
    });
  } catch (err: any) {
    console.error('memorial/partner-info error:', err);
    return NextResponse.json(
      { error: 'Could not load partner details' },
      { status: 500 }
    );
  }
}
