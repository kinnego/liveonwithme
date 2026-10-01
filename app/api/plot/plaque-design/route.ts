import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { MAX_BOTTOM_TEXT_LEN } from '@/lib/plaque';
import { checkPlotAccess } from '@/lib/plot-access';
import type { PlaqueShape } from '@/lib/types';

export const runtime = 'nodejs';

const VALID_SHAPES: PlaqueShape[] = ['oval', 'round', 'square'];

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const body = await req.json();
    const plotId = typeof body.plotId === 'string' ? body.plotId : '';
    const shape = VALID_SHAPES.includes(body.shape) ? (body.shape as PlaqueShape) : null;
    const bottomTextRaw = typeof body.bottomText === 'string' ? body.bottomText : '';
    const bottomText = bottomTextRaw.trim().slice(0, MAX_BOTTOM_TEXT_LEN);
    const customMarkPath =
      typeof body.customMarkPath === 'string' && body.customMarkPath.startsWith('plots/')
        ? body.customMarkPath
        : body.customMarkPath === null
          ? null
          : undefined; // undefined = don't change
    const showBorder = typeof body.showBorder === 'boolean' ? body.showBorder : undefined;

    if (!plotId) return NextResponse.json({ error: 'plotId required' }, { status: 400 });
    if (!shape) return NextResponse.json({ error: 'A valid shape is required.' }, { status: 400 });

    const db = adminDb();
    const { allowed, role, plot: plotSnap } = await checkPlotAccess(db, uid, plotId);
    if (!plotSnap) return NextResponse.json({ error: 'Plot not found' }, { status: 404 });
    if (!allowed)
      return NextResponse.json({ error: 'Only a plot administrator or referring partner can edit this plaque.' }, { status: 403 });
    const plot = plotSnap.data()!;

    const plaqueDesign: Record<string, unknown> = {
      shape,
      bottomText: bottomText || null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (customMarkPath !== undefined) {
      plaqueDesign.customMarkPath = customMarkPath; // either a string or null (reset)
    } else {
      // Preserve existing value if the client did not touch it.
      const existing = (plot.plaqueDesign as any)?.customMarkPath;
      plaqueDesign.customMarkPath = existing ?? null;
    }
    if (showBorder !== undefined) {
      plaqueDesign.showBorder = showBorder;
    } else {
      const existing = (plot.plaqueDesign as any)?.showBorder;
      plaqueDesign.showBorder = existing !== false; // default true
    }

    const plotRef = db.collection('plots').doc(plotId);
    await plotRef.update({ plaqueDesign, updatedAt: FieldValue.serverTimestamp() });

    // Audit trail — every design change records who did it and in what role,
    // so partner edits are traceable alongside admin + super-admin edits.
    const actor = await adminAuth().getUser(uid).catch(() => null);
    await db.collection('auditEvents').add({
      entityType: 'plot',
      entityId: plotId,
      action: 'plaque_design_updated',
      actorUid: uid,
      actorEmail: actor?.email || null,
      actorRole: role,
      createdAt: new Date(),
      details: {
        shape,
        hasBottomText: !!bottomText,
        hasCustomMark: !!plaqueDesign.customMarkPath,
        showBorder: plaqueDesign.showBorder,
      },
    });

    return NextResponse.json({ ok: true, plaqueDesign });
  } catch (err: any) {
    console.error('plaque-design error', err);
    return NextResponse.json({ error: err.message || 'Could not save' }, { status: 500 });
  }
}
