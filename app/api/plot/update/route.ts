// Plot name update. Kept narrow on purpose — this endpoint only edits the
// optional label; location (lat/lng) is written client-side via the
// existing `updatePlotLocation` helper under the plots admin rule, and
// plaque design lives in `/api/plot/plaque-design`. If we ever add more
// plot-level fields we can either grow this route or split again.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { checkPlotAccess } from '@/lib/plot-access';

export const runtime = 'nodejs';

const MAX_NAME_LEN = 80;

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const body = await req.json().catch(() => ({}));
    const plotId = typeof body?.plotId === 'string' ? body.plotId : '';
    if (!plotId) {
      return NextResponse.json({ error: 'plotId required' }, { status: 400 });
    }

    const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
    const name = rawName.slice(0, MAX_NAME_LEN);

    const db = adminDb();
    const { allowed, role, plot: plotSnap } = await checkPlotAccess(db, uid, plotId);
    if (!plotSnap) {
      return NextResponse.json({ error: 'Plot not found' }, { status: 404 });
    }
    if (!allowed) {
      return NextResponse.json(
        { error: 'Only a plot administrator can rename this plot.' },
        { status: 403 },
      );
    }
    // Partners legitimately edit the plaque, but renaming the plot is a
    // custody-flavoured action the family should own.
    if (role === 'partner') {
      return NextResponse.json(
        { error: 'Only the plot administrator can rename this plot.' },
        { status: 403 },
      );
    }

    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    // Empty string clears the label — plot.name is optional in the Plot type.
    update.name = name || FieldValue.delete();

    await db.collection('plots').doc(plotId).update(update);

    const actor = await adminAuth().getUser(uid).catch(() => null);
    await db.collection('auditEvents').add({
      entityType: 'plot',
      entityId: plotId,
      action: name ? 'renamed' : 'name_cleared',
      actorUid: uid,
      actorEmail: actor?.email || null,
      actorRole: role,
      createdAt: new Date(),
      details: name ? { name } : undefined,
    });

    return NextResponse.json({ ok: true, name: name || null });
  } catch (err: any) {
    console.error('plot/update error', err);
    return NextResponse.json({ error: 'Could not save' }, { status: 500 });
  }
}
