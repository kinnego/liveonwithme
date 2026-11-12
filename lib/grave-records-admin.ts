// Server-side helpers for the cemetery burial register: auth of callers,
// registrar checks, input validation, candidate lookup for matching and
// adoption-safe writes.
// Everything in graveRecords / cemeteryRegistrars /
// graveReports is admin-SDK only — firestore.rules deny all client access.

import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebase-admin';
import { shortId } from './ids';
import { graveLabel, graveSearchKeys, normalise, surnameKey, toIndexBurial, yearOf, type GraveIndexEntry } from './grave-match';
import { graveKeyOf } from './register-parse';
import type { Cemetery, GraveBurial, GraveRecord } from './types';

export const GRAVE_COLLECTION = 'graveRecords';
export const REGISTRAR_COLLECTION = 'cemeteryRegistrars';
export const GRAVE_REPORT_COLLECTION = 'graveReports';
export const UPLOAD_COLLECTION = 'registerUploads';
export const PROFILE_COLLECTION = 'registerProfiles';

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
  graveKey: string;
  section: string;
  row: string;
  plotNumber: string;
  inscription: string;
  burials: GraveBurial[];
  /** Name prefixes for search, written with the names (see graveSearchKeys). */
  searchKeys: string[];
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
    for (const f of ['nickname', 'born', 'buried'] as const) {
      const v = str(b[f], 40);
      if (v) burial[f] = v;
    }
    for (const f of ['address', 'relations', 'notes'] as const) {
      const v = str(b[f], 300);
      if (v) burial[f] = v;
    }
    burials.push(burial);
  }
  if (burials.length === 0) {
    throw new HttpError(400, 'Add at least one name with a surname.');
  }
  const lat = typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : null;
  const lng = typeof body.lng === 'number' && Number.isFinite(body.lng) ? body.lng : null;
  if ((lat === null) !== (lng === null)) throw new HttpError(400, 'Pin is incomplete.');
  const section = str(body.section, 30);
  const row = str(body.row, 30);
  const plotNumber = str(body.plotNumber, 30);
  return {
    graveKey: graveKeyOf({ section, row, plotNumber, burials }),
    section,
    row,
    plotNumber,
    inscription: str(body.inscription, MAX_INSCRIPTION),
    burials,
    searchKeys: graveSearchKeys(burials),
    lat,
    lng,
  };
}

// ─── Matching ─────────────────────────────────────────────────────────────

export function indexEntryOf(id: string, g: Partial<GraveRecord>): GraveIndexEntry {
  return {
    id,
    l: graveLabel(g),
    b: (g.burials || []).map((b) =>
      toIndexBurial({
        surname: b.surname,
        // Nicknames match too: "Hughie" in the register finds Hugh.
        forenames: [b.forenames, b.nickname].filter(Boolean).join(' '),
        diedYear: b.diedYear ?? null,
      }),
    ),
    a: g.status === 'adopted',
    p: g.adoptedPlotId ?? null,
    g: typeof g.lat === 'number' && typeof g.lng === 'number',
  };
}

/** How many candidate graves one suggestion may read. */
const SUGGEST_SCAN = 200;

/**
 * Graves in one cemetery that could match a surname, as match entries.
 *
 * Every record carries `searchKeys` (written with its names), so this is one
 * indexed query on (placeId, searchKeys) that reads only plausible graves,
 * however big the register gets. The 4-letter surname prefix keeps typos
 * after the start of the name ("Gallager") and Irish/English forms (which
 * share a surname key) in the candidate set for the fuzzy scorer.
 */
export async function candidateGraves(db: Firestore, placeId: string, surname: string): Promise<GraveIndexEntry[]> {
  const keys = new Set<string>();
  const sk = surnameKey(surname);
  const plain = normalise(surname).replace(/\s+/g, '');
  for (const k of [sk, plain]) {
    if (k.length >= 3) keys.add(k.slice(0, 4));
  }
  if (keys.size === 0) return [];
  const snap = await db
    .collection(GRAVE_COLLECTION)
    .where('placeId', '==', placeId)
    .where('searchKeys', 'array-contains-any', [...keys])
    .limit(SUGGEST_SCAN)
    .get();
  return snap.docs.map((d) => indexEntryOf(d.id, d.data() as GraveRecord));
}

/** Number of graves in a cemetery's register (a count aggregation, not a scan). */
export async function registerCount(db: Firestore, placeId: string): Promise<number> {
  const agg = await db.collection(GRAVE_COLLECTION).where('placeId', '==', placeId).count().get();
  return agg.data().count;
}

const ADOPTED_MESSAGE = 'A family looks after this grave now, so it can’t be changed here.';

/**
 * Change a grave only if no family has adopted it, checked inside a
 * transaction so an adoption landing at the same moment always wins.
 * `data` may be a function of the current record (for merges).
 */
export async function updateUnlessAdopted(
  db: Firestore,
  ref: DocumentReference,
  data: Record<string, unknown> | ((current: GraveRecord) => Record<string, unknown>),
  opts: { allowAdopted?: boolean } = {},
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, 'Grave not found.');
    const current = snap.data() as GraveRecord;
    if (current.status === 'adopted' && !opts.allowAdopted) throw new HttpError(409, ADOPTED_MESSAGE);
    tx.update(ref, typeof data === 'function' ? data(current) : data);
  });
}

/** Delete a grave only if no family has adopted it (transactional). Returns what was deleted. */
export async function deleteUnlessAdopted(
  db: Firestore,
  ref: DocumentReference,
  opts: { allowAdopted?: boolean } = {},
): Promise<GraveRecord | null> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const current = snap.data() as GraveRecord;
    if (current.status === 'adopted' && !opts.allowAdopted) throw new HttpError(409, ADOPTED_MESSAGE);
    tx.delete(ref);
    return current;
  });
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
    photoPath: g.photoPath || null,
    status: g.status,
    adoptedPlotId: g.adoptedPlotId || null,
    source: g.source,
    uploadId: g.uploadId || null,
    editedByHand: !!g.editedByHand,
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
