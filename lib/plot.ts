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
  plotAdminUid: string;
  createdByUid: string;
  name?: string;
}

export async function createPlot(input: CreatePlotInput): Promise<Plot> {
  if (!db) throw new Error('Firestore not available');
  const id = doc(collection(db, 'plots')).id;
  const sId = await generateUniquePlotShortId();
  const plot: Omit<Plot, 'id'> = {
    shortId: sId,
    name: input.name,
    cemetery: input.cemetery,
    plotAdminUid: input.plotAdminUid,
    plotAdminSuccessorUids: [],
    createdByUid: input.createdByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
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
    personId: input.personId,
    requestedByUid: input.requestedByUid,
    status,
    approvedByUid: input.autoApprove ? input.requestedByUid : undefined,
    approvedAt: input.autoApprove ? serverTimestamp() : undefined,
    createdAt: serverTimestamp(),
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
