// Plot + PlotMembership helpers. A Plot represents a physical grave; a Plot
// can host many Memorials via PlotMembership records that require Plot
// Administrator approval.

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { shortId } from './ids';
import {
  Cemetery,
  Memorial,
  Plot,
  PlotMembership,
  PlotMembershipStatus,
} from './types';

export interface CreatePlotInput {
  cemetery: Cemetery;
  /** UID of the creating user — becomes the first (and initially only) admin. */
  plotAdminUid: string;
  createdByUid: string;
  name?: string;
}

// Returns the effective set of plot admins, handling both the new
// plotAdminUids array and legacy single-admin docs.
export function plotAdmins(
  plot: Pick<Plot, 'plotAdminUids' | 'plotAdminUid'> | null | undefined,
): string[] {
  if (!plot) return [];
  const arr = plot.plotAdminUids;
  if (Array.isArray(arr) && arr.length > 0) return arr;
  const single = plot.plotAdminUid;
  return single ? [single] : [];
}

// True if `uid` is one of the plot admins OR one of the pre-approved
// successors (successors are allowed to act as admins today; the succession
// list is really "pre-authorised administrators").
export function isPlotAdmin(
  plot:
    | Pick<Plot, 'plotAdminUids' | 'plotAdminUid' | 'plotAdminSuccessorUids'>
    | null
    | undefined,
  uid: string,
): boolean {
  if (!plot || !uid) return false;
  if (plotAdmins(plot).includes(uid)) return true;
  return (plot.plotAdminSuccessorUids || []).includes(uid);
}

export async function createPlot(input: CreatePlotInput): Promise<Plot> {
  if (!db) throw new Error('Firestore not available');
  const id = doc(collection(db, 'plots')).id;
  const sId = await generateUniquePlotShortId();
  const plot: Omit<Plot, 'id'> = {
    shortId: sId,
    cemetery: input.cemetery,
    plotAdminUids: [input.plotAdminUid],
    plotAdminSuccessorUids: [],
    createdByUid: input.createdByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(input.name ? { name: input.name } : {}),
  };
  await (
    await import('firebase/firestore')
  ).setDoc(doc(db, 'plots', id), plot);
  return { id, ...plot };
}

async function generateUniquePlotShortId(maxAttempts = 6): Promise<string> {
  if (!db) throw new Error('Firestore not available');
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = shortId(8);
    const existing = await getDocs(
      query(collection(db, 'plots'), where('shortId', '==', candidate), limit(1))
    );
    if (existing.empty) return candidate;
  }
  throw new Error('Could not generate a unique plot short id');
}

export async function readPlot(id: string): Promise<Plot | null> {
  if (!db) return null;
  const snap = await getDoc(doc(db, 'plots', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<Plot, 'id'>) };
}

export async function readPlotByShortId(sId: string): Promise<Plot | null> {
  if (!db) return null;
  const snap = await getDocs(
    query(collection(db, 'plots'), where('shortId', '==', sId), limit(1))
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as Omit<Plot, 'id'>) };
}

export async function readApprovedMemberships(plotId: string): Promise<PlotMembership[]> {
  if (!db) return [];
  const snap = await getDocs(
    query(
      collection(db, 'plotMemberships'),
      where('plotId', '==', plotId),
      where('status', '==', 'approved')
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PlotMembership, 'id'>) }));
}

export async function requestPlotMembership(input: {
  plotId: string;
  memorialId: string;
  personId?: string;
  requestedByUid: string;
  autoApprove?: boolean; // true when the requester is the plot admin
}): Promise<PlotMembership> {
  if (!db) throw new Error('Firestore not available');
  const status: PlotMembershipStatus = input.autoApprove ? 'approved' : 'requested';
  const ref = await addDoc(collection(db, 'plotMemberships'), {
    plotId: input.plotId,
    memorialId: input.memorialId,
    requestedByUid: input.requestedByUid,
    status,
    createdAt: serverTimestamp(),
    ...(input.personId ? { personId: input.personId } : {}),
    ...(input.autoApprove
      ? { approvedByUid: input.requestedByUid, approvedAt: serverTimestamp() }
      : {}),
  });
  if (input.autoApprove) {
    await updateDoc(doc(db, 'memorials', input.memorialId), {
      plotId: input.plotId,
      updatedAt: serverTimestamp(),
    });
  }
  return {
    id: ref.id,
    plotId: input.plotId,
    memorialId: input.memorialId,
    personId: input.personId,
    requestedByUid: input.requestedByUid,
    status,
  };
}

// Ensures a memorial with a `cemetery` set has a Plot. Idempotent: no-op if
// the memorial already has a plotId or has no cemetery.
export async function ensurePlotForMemorial(m: Memorial): Promise<string | null> {
  if (!db) return null;
  if (m.plotId) return m.plotId;
  if (!m.cemetery?.placeId) return null;

  const plot = await createPlot({
    cemetery: m.cemetery,
    plotAdminUid: m.ownerId,
    createdByUid: m.ownerId,
  });
  await requestPlotMembership({
    plotId: plot.id,
    memorialId: m.id,
    personId: m.personId,
    requestedByUid: m.ownerId,
    autoApprove: true,
  });
  return plot.id;
}

// Attaches a newly-created memorial to an existing plot the caller
// administers. Copies the plot's cemetery onto the memorial so the memorial
// page renders consistently, and creates an auto-approved PlotMembership.
export async function attachMemorialToExistingPlot(input: {
  memorialId: string;
  personId?: string;
  plotId: string;
  requestedByUid: string;
}): Promise<void> {
  if (!db) throw new Error('Firestore not available');
  const plot = await readPlot(input.plotId);
  if (!plot) throw new Error('Plot not found');
  const isAdmin = isPlotAdmin(plot, input.requestedByUid);
  await requestPlotMembership({
    plotId: input.plotId,
    memorialId: input.memorialId,
    personId: input.personId,
    requestedByUid: input.requestedByUid,
    autoApprove: isAdmin,
  });
  if (isAdmin) {
    await (
      await import('firebase/firestore')
    ).updateDoc(doc(db, 'memorials', input.memorialId), {
      plotId: input.plotId,
      cemetery: plot.cemetery,
      updatedAt: serverTimestamp(),
    });
  }
}
