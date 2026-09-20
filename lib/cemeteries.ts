// Helpers for community-added cemeteries. See CustomCemetery in lib/types.ts.
//
// URL scheme: /cemetery/[placeId] handles both Google place IDs (ChIJ…) and
// our own community IDs. To keep the two ID spaces separate we prefix custom
// IDs with `c-` when they appear as a placeId. In the Firestore doc, the id
// field is the raw Firestore doc ID (no prefix).

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import type { CustomCemetery } from './types';

export const CUSTOM_PLACE_ID_PREFIX = 'c-';

export function isCustomPlaceId(placeId: string): boolean {
  return placeId.startsWith(CUSTOM_PLACE_ID_PREFIX);
}

export function customPlaceIdOf(id: string): string {
  return `${CUSTOM_PLACE_ID_PREFIX}${id}`;
}

export function customIdFromPlaceId(placeId: string): string {
  return placeId.startsWith(CUSTOM_PLACE_ID_PREFIX)
    ? placeId.slice(CUSTOM_PLACE_ID_PREFIX.length)
    : placeId;
}

export async function createCustomCemetery(input: {
  name: string;
  address?: string;
  lat: number;
  lng: number;
  createdByUid?: string;
  createdByEmail?: string;
}): Promise<CustomCemetery> {
  if (!db) throw new Error('Firestore not available');
  const name = input.name.trim();
  if (!name) throw new Error('Cemetery name is required');
  if (!input.createdByUid && !input.createdByEmail) {
    throw new Error('Either createdByUid or createdByEmail must be provided');
  }

  const payload: Record<string, unknown> = {
    name,
    nameLower: name.toLowerCase(),
    address: input.address?.trim() || '',
    lat: input.lat,
    lng: input.lng,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (input.createdByUid) payload.createdByUid = input.createdByUid;
  if (input.createdByEmail) payload.createdByEmail = input.createdByEmail;

  const ref = await addDoc(collection(db, 'cemeteries'), payload);
  return { id: ref.id, ...payload } as unknown as CustomCemetery;
}

export async function readCustomCemetery(id: string): Promise<CustomCemetery | null> {
  if (!db) throw new Error('Firestore not available');
  const snap = await getDoc(doc(db, 'cemeteries', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<CustomCemetery, 'id'>) };
}

// Prefix search on nameLower. Case-insensitive because the input is lowercased.
export async function searchCustomCemeteries(
  term: string,
  limit = 5,
): Promise<CustomCemetery[]> {
  if (!db) return [];
  const q = term.trim().toLowerCase();
  if (q.length < 2) return [];
  const snap = await getDocs(
    query(
      collection(db, 'cemeteries'),
      where('nameLower', '>=', q),
      where('nameLower', '<=', q + '\uf8ff'),
      orderBy('nameLower'),
      fsLimit(limit),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomCemetery, 'id'>) }));
}

export async function updateCustomCemeteryName(
  id: string,
  newName: string,
  updatedByUid: string,
): Promise<void> {
  if (!db) throw new Error('Firestore not available');
  const name = newName.trim();
  if (!name) throw new Error('Name cannot be empty');
  await updateDoc(doc(db, 'cemeteries', id), {
    name,
    nameLower: name.toLowerCase(),
    updatedByUid,
    updatedAt: serverTimestamp(),
  });
}

export async function submitCemeteryReport(input: {
  cemeteryId: string;
  reason: string;
  reporterEmail?: string;
  reporterUid?: string;
}): Promise<void> {
  if (!db) throw new Error('Firestore not available');
  const reason = input.reason.trim();
  if (!reason) throw new Error('Please explain the problem');
  const payload: Record<string, unknown> = {
    cemeteryId: input.cemeteryId,
    reason,
    status: 'open',
    createdAt: serverTimestamp(),
  };
  if (input.reporterEmail) payload.reporterEmail = input.reporterEmail;
  if (input.reporterUid) payload.reporterUid = input.reporterUid;
  await addDoc(collection(db, 'cemeteryReports'), payload);
}
