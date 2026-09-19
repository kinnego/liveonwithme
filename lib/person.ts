import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { Memorial, Person } from './types';

export interface CreatePersonInput {
  fullName: string;
  born?: string;
  died?: string;
  isLiving: boolean;
  createdByUid: string;
}

export async function createPerson(input: CreatePersonInput): Promise<string> {
  if (!db) throw new Error('Firestore not available');
  const doc: Record<string, unknown> = {
    fullName: input.fullName,
    isLiving: input.isLiving,
    createdByUid: input.createdByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (input.born) doc.born = input.born;
  if (input.died) doc.died = input.died;
  const ref = await addDoc(collection(db, 'persons'), doc);
  return ref.id;
}

// Backfills a Person for a memorial that predates the Person concept.
// Idempotent: returns the existing personId if the memorial already has one.
export async function ensurePersonForMemorial(m: Memorial): Promise<string> {
  if (m.personId) return m.personId;
  if (!db) throw new Error('Firestore not available');

  const personId = await createPerson({
    fullName: m.fullName,
    born: m.born,
    died: m.died,
    isLiving: !m.died,
    createdByUid: m.ownerId,
  });
  await updateDoc(doc(db, 'memorials', m.id), {
    personId,
    updatedAt: serverTimestamp(),
  });
  return personId;
}

export async function readPerson(id: string): Promise<Person | null> {
  if (!db) return null;
  const snap = await getDoc(doc(db, 'persons', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<Person, 'id'>) };
}
