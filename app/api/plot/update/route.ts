// Plot-level edits that must be gated server-side: the optional label and
// the cemetery itself. Location (lat/lng) is written client-side via
// `updatePlotLocation` under the plots admin rule, and plaque design lives
// in `/api/plot/plaque-design`.
//
// The route is union-shaped: callers pass `name` to edit the label or
// `cemetery` to swap the cemetery. Partners can touch neither — both are
// custody-flavoured actions the family should own.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, verifyIdToken } from '@/lib/firebase-admin';
import { checkPlotAccess } from '@/lib/plot-access';

export const runtime = 'nodejs';

const MAX_NAME_LEN = 80;

type CemeteryPayload = {
  name: string;
  address: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
};

function parseCemetery(raw: unknown): CemeteryPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const name = typeof c.name === 'string' ? c.name.trim() : '';
  const placeId = typeof c.placeId === 'string' ? c.placeId.trim() : '';
  if (!name || !placeId) return null;
  const address = typeof c.address === 'string' ? c.address.trim() : '';
  const lat = typeof c.lat === 'number' && Number.isFinite(c.lat) ? c.lat : null;
  const lng = typeof c.lng === 'number' && Number.isFinite(c.lng) ? c.lng : null;
  return { name, address, placeId, lat, lng };
}

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyIdToken(req.headers.get('Authorization'));
    const body = await req.json().catch(() => ({}));
    const plotId = typeof body?.plotId === 'string' ? body.plotId : '';
    if (!plotId) {
      return NextResponse.json({ error: 'plotId required' }, { status: 400 });
    }

    const hasName = typeof body?.name === 'string';
    const hasCemetery = body?.cemetery !== undefined;
    if (!hasName && !hasCemetery) {
      return NextResponse.json({ error: 'name or cemetery required' }, { status: 400 });
    }

    const rawName = hasName ? (body.name as string).trim() : '';
    const name = rawName.slice(0, MAX_NAME_LEN);
    const cemetery = hasCemetery ? parseCemetery(body.cemetery) : null;
    if (hasCemetery && !cemetery) {
      return NextResponse.json(
        { error: 'cemetery is incomplete — a name and place ID are required.' },
        { status: 400 },
      );
    }

    const db = adminDb();
    const { allowed, role, plot: plotSnap } = await checkPlotAccess(db, uid, plotId);
    if (!plotSnap) {
      return NextResponse.json({ error: 'Plot not found' }, { status: 404 });
    }
    if (!allowed) {
      return NextResponse.json(
        { error: 'Only a plot administrator can edit this plot.' },
        { status: 403 },
      );
    }
    if (role === 'partner') {
      return NextResponse.json(
        { error: 'Only the plot administrator can edit this plot.' },
        { status: 403 },
      );
    }

    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (hasName) {
      // Empty string clears the label — plot.name is optional in the Plot type.
      update.name = name || FieldValue.delete();
    }
    if (cemetery) {
      update.cemetery = cemetery;
      // The grave pin was specific to the previous cemetery grounds. Keep it
      // and we'd be pointing families at a plot in a different cemetery.
      update.lat = FieldValue.delete();
      update.lng = FieldValue.delete();
    }

    await db.collection('plots').doc(plotId).update(update);

    const actor = await adminAuth().getUser(uid).catch(() => null);
    const action = cemetery
      ? 'cemetery_changed'
      : name
        ? 'renamed'
        : 'name_cleared';
    const details: Record<string, unknown> = {};
    if (hasName) details.name = name || null;
    if (cemetery) details.cemetery = { name: cemetery.name, placeId: cemetery.placeId };
    await db.collection('auditEvents').add({
      entityType: 'plot',
      entityId: plotId,
      action,
      actorUid: uid,
      actorEmail: actor?.email || null,
      actorRole: role,
      createdAt: new Date(),
      details: Object.keys(details).length ? details : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('plot/update error', err);
    return NextResponse.json({ error: 'Could not save' }, { status: 500 });
  }
}
