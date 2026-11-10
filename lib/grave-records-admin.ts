// Server-side helpers for the cemetery burial register: auth of callers,
// registrar checks, input validation and the per-cemetery match index.
// Everything in graveRecords / graveIndex / cemeteryRegistrars /
// graveReports is admin-SDK only — firestore.rules deny all client access.

import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebase-admin';
import { shortId } from './ids';
import { graveLabel, toIndexBurial, yearOf, type GraveIndexEntry } from './grave-match';
import type { Cemetery, GraveBurial, GraveRecord } from './types';

export const GRAVE_COLLECTION = 'graveRecords';
export const GRAVE_INDEX_COLLECTION = 'graveIndex';
export const REGISTRAR_COLLECTION = 'cemeteryRegistrars';
export const GRAVE_REPORT_COLLECTION = 'graveReports';

/** Max graves one registrar can add or edit per day. Stops junk dumps. */
export const REGISTRAR_DAILY_WRITE_CAP = 300;
export const MAX_BURIALS_PER_GRAVE = 12;

const MAX_FIELD = 80;
const MAX_INSCRIPTION = 1000;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Caller {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  isSuperAdmin: boolean;
}

export async function getCaller(authHeader: string | null): Promise<Caller> {
  if (!authHeader?.startsWith('Bearer ')) throw new HttpError(401, 'Please sign in.');
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(authHeader.slice('Bearer '.length));
  } catch {
    throw new HttpError(401, 'Please sign in again.');
  }
  const prof = await adminDb().collection('users').doc(decoded.uid).get();
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    emailVerified: decoded.email_verified === true,
    isSuperAdmin: prof.exists && prof.data()?.role === 'super_admin',
  };
}

export function registrarDocId(placeId: string, uid: string): string {
  return `${placeId}__${uid}`;
}

export async function isActiveRegistrar(db: Firestore, placeId: string, uid: string): Promise<boolean> {
  const snap = await db.collection(REGISTRAR_COLLECTION).doc(registrarDocId(placeId, uid)).get();
  return snap.exists && snap.data()?.status === 'active';
}

export async function requireRegistrar(db: Firestore, caller: Caller, placeId: string): Promise<void> {
  if (caller.isSuperAdmin) return;
  if (await isActiveRegistrar(db, placeId, caller.uid)) return;
  throw new HttpError(403, 'Only a registrar of this cemetery can do that.');
}

export async function activeRegistrarCount(db: Firestore, placeId: string): Promise<number> {
  const snap = await db
    .collection(REGISTRAR_COLLECTION)
    .where('placeId', '==', placeId)
    .where('status', '==', 'active')
    .limit(50)
    .get();
  return snap.size;
}

// ─── Input validation ────────────────────────────────────────────────────────

function str(v: unknown, max = MAX_FIELD): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function parseCemetery(raw: unknown): Cemetery | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const name = str(c.name, 160);
  const placeId = str(c.placeId, 200);
  if (!name || !placeId) return null;
  const lat = typeof c.lat === 'number' && Number.isFinite(c.lat) ? c.lat : null;
  const lng = typeof c.lng === 'number' && Number.isFinite(c.lng) ? c.lng : null;
  return { name, placeId, address: str(c.address, 300), lat, lng };
}

export interface GraveInput {
  section: string;
  row: string;
  plotNumber: string;
  inscription: string;
  burials: GraveBurial[];
  lat: number | null;
  lng: number | null;
}

export function parseGraveInput(body: Record<string, unknown>): GraveInput {
  const rawBurials = Array.isArray(body.burials) ? body.burials : [];
  const burials: GraveBurial[] = [];
  for (const raw of rawBurials.slice(0, MAX_BURIALS_PER_GRAVE)) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as Record<string, unknown>;
    const surname = str(b.surname);
    if (!surname) continue;
    const died = str(b.died, 40);
    const burial: GraveBurial = { surname, diedYear: yearOf(died) };
    const forenames = str(b.forenames);
    if (forenames) burial.forenames = forenames;
    if (died) burial.died = died;
    const age = str(b.age, 20);
    if (age) burial.age = age;
    const notes = str(b.notes, 300);
    if (notes) burial.notes = notes;
    burials.push(burial);
  }
  if (burials.length === 0) {
    throw new HttpError(400, 'Add at least one name with a surname.');
  }
  const lat = typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : null;
  const lng = typeof body.lng === 'number' && Number.isFinite(body.lng) ? body.lng : null;
  if ((lat === null) !== (lng === null)) throw new HttpError(400, 'Pin is incomplete.');
  return {
    section: str(body.section, 30),
    row: str(body.row, 30),
    plotNumber: str(body.plotNumber, 30),
    inscription: str(body.inscription, MAX_INSCRIPTION),
    burials,
    lat,
    lng,
  };
}

// ─── Match index ─────────────────────────────────────────────────────────────

export function indexEntryOf(id: string, g: Partial<GraveRecord>): GraveIndexEntry {
  return {
    id,
    l: graveLabel(g),
    b: (g.burials || []).map((b) =>
      toIndexBurial({ surname: b.surname, forenames: b.forenames, diedYear: b.diedYear ?? null }),
    ),
    a: g.status === 'adopted',
    p: g.adoptedPlotId ?? null,
    g: typeof g.lat === 'number' && typeof g.lng === 'number',
  };
}

/**
 * Rebuild `graveIndex/{placeId}` from the cemetery's grave records.
 * Called after every write. Reading every grave of one cemetery is cheap at
 * parish scale and always leaves the index correct, even after concurrent
 * edits, which a hand-patched index wouldn't guarantee.
 */
export async function rebuildGraveIndex(db: Firestore, placeId: string): Promise<number> {
  const snap = await db.collection(GRAVE_COLLECTION).where('placeId', '==', placeId).get();
  const entries = snap.docs.map((d) => indexEntryOf(d.id, d.data() as GraveRecord));
  await db.collection(GRAVE_INDEX_COLLECTION).doc(placeId).set({
    placeId,
    entries,
    count: entries.length,
    updatedAt: new Date(),
  });
  return entries.length;
}

export async function readGraveIndex(db: Firestore, placeId: string): Promise<GraveIndexEntry[]> {
  const snap = await db.collection(GRAVE_INDEX_COLLECTION).doc(placeId).get();
  if (!snap.exists) return [];
  const entries = snap.data()?.entries;
  return Array.isArray(entries) ? (entries as GraveIndexEntry[]) : [];
}

// ─── Serialisation ───────────────────────────────────────────────────────────

function millis(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === 'function' ? t.toMillis() : null;
}

/** Shape sent to the registrar UI. */
export function serializeGrave(id: string, data: Record<string, unknown>) {
  const g = data as unknown as GraveRecord;
  return {
    id,
    placeId: g.placeId,
    section: g.section || '',
    row: g.row || '',
    plotNumber: g.plotNumber || '',
    lat: typeof g.lat === 'number' ? g.lat : null,
    lng: typeof g.lng === 'number' ? g.lng : null,
    burials: g.burials || [],
    inscription: g.inscription || '',
    status: g.status,
    adoptedPlotId: g.adoptedPlotId || null,
    source: g.source,
    updatedAt: millis(g.updatedAt),
  };
}

export type SerializedGrave = ReturnType<typeof serializeGrave>;

// ─── Plots ───────────────────────────────────────────────────────────────────

export async function uniquePlotShortId(db: Firestore, tx?: Transaction): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const candidate = shortId(8);
    const q = db.collection('plots').where('shortId', '==', candidate).limit(1);
    const existing = tx ? await tx.get(q) : await q.get();
    if (existing.empty) return candidate;
  }
  throw new Error('Could not generate a unique plot short id');
}

export function errorResponseBody(err: unknown): { status: number; error: string } {
  if (err instanceof HttpError) return { status: err.status, error: err.message };
  console.error('[grave-records]', err);
  return { status: 500, error: 'Something went wrong. Please try again.' };
}
