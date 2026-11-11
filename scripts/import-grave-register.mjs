// Import a parish burial register (spreadsheet saved as CSV) into the
// `graveRecords` collection.
//
// One row per burial. Rows that share a section + row + plot number are
// grouped into one grave (Irish family graves often hold several people).
// Rows without a plot number each become their own grave.
//
// Re-runnable: each grave gets a deterministic id from its position, so a
// second run updates rather than duplicates. Graves a family has already
// adopted are never touched.
//
// Usage (from the repo root):
//   node --env-file=.env.local scripts/import-grave-register.mjs \
//     --file register.csv --place-id <placeId> --cemetery-name "St Mary's, Killybegs" \
//     [--address "Killybegs, Co. Donegal"] [--lat 54.63 --lng -8.44] [--dry]
//
// --dry parses and prints a summary without touching Firestore (and needs no
// credentials). Without --lat/--lng the cemetery's coordinates are copied
// from an existing plot or community cemetery with the same place id.
//
// Column headers are matched loosely, by the same parser the registrar
// page's upload uses (lib/register-parse.ts). See
// scripts/grave-register-template.csv.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { graveLabel, graveSearchKeys } from '../lib/grave-match.ts';
import { parseRegister } from '../lib/register-parse.ts';

// ─── args ────────────────────────────────────────────────────────────────────

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const DRY = process.argv.includes('--dry');
const file = arg('file');
const placeId = arg('place-id');
const cemeteryName = arg('cemetery-name');
const address = arg('address') || '';
const latArg = arg('lat');
const lngArg = arg('lng');

if (!file || !placeId || !cemeteryName) {
  console.error('Usage: --file register.csv --place-id <placeId> --cemetery-name "Name" [--address ...] [--lat N --lng N] [--dry]');
  process.exit(1);
}

// ─── parse (same parser as the registrar page's upload) ──────────────────────

const parsed = parseRegister(readFileSync(file, 'utf8'));
if (parsed.error) {
  console.error(parsed.error);
  process.exit(1);
}
const graves = new Map(parsed.graves.map((g) => [`${placeId}|${g.key}`, g]));
const burialCount = parsed.people;
const skipped = parsed.skippedRows.length;
if (parsed.unknownHeaders.length) console.warn(`Ignoring unrecognised columns: ${parsed.unknownHeaders.join(', ')}`);
if (parsed.uncertainCells) console.warn(`${parsed.uncertainCells} cells are marked ?? as hard to read.`);

const docIdOf = (key) => `imp_${createHash('sha1').update(key).digest('hex').slice(0, 20)}`;

console.log(`${cemeteryName}: ${burialCount} burials in ${graves.size} graves (${skipped} rows skipped with no surname).`);
const multi = [...graves.values()].filter((g) => g.burials.length > 1).length;
console.log(`${multi} graves hold more than one person.`);
for (const g of [...graves.values()].slice(0, 5)) {
  console.log(` • ${graveLabel(g) || '(no location)'}: ${g.burials.map((b) => `${b.forenames || ''} ${b.surname} ${b.died || ''}`.trim()).join('; ')}`);
}

if (DRY) {
  console.log('Dry run: nothing written.');
  process.exit(0);
}

// ─── write ───────────────────────────────────────────────────────────────────

const { cert, initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing Firebase Admin credentials (run with --env-file=.env.local).');
  process.exit(1);
}
initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

let lat = latArg !== undefined ? Number(latArg) : null;
let lng = lngArg !== undefined ? Number(lngArg) : null;
if (lat === null || lng === null) {
  const plots = await db.collection('plots').where('cemetery.placeId', '==', placeId).limit(1).get();
  const c = plots.empty ? null : plots.docs[0].data().cemetery;
  if (c && typeof c.lat === 'number') {
    lat = c.lat;
    lng = c.lng;
  } else if (placeId.startsWith('c-')) {
    const custom = await db.collection('cemeteries').doc(placeId.slice(2)).get();
    if (custom.exists) {
      lat = custom.data().lat;
      lng = custom.data().lng;
    }
  }
}
const cemetery = { name: cemeteryName, address, placeId, lat: lat ?? null, lng: lng ?? null };
if (cemetery.lat === null) console.warn('No cemetery coordinates found; maps will need --lat/--lng later.');

// Each write is conditional: new graves are created (fails if the id now
// exists) and existing ones are updated only if unchanged since we read
// them, so a family adopting a grave mid-import always wins. A batch that
// loses a race is redone one write at a time, skipping the losers.
let written = 0;
let keptAdopted = 0;
const entries = [...graves.entries()];
for (let i = 0; i < entries.length; i += 200) {
  const chunk = entries.slice(i, i + 200);
  const refs = chunk.map(([key]) => db.collection('graveRecords').doc(docIdOf(key)));
  const existing = await db.getAll(...refs);
  const ops = [];
  chunk.forEach(([, g], j) => {
    const prev = existing[j];
    if (prev.exists && prev.data().status === 'adopted') {
      keptAdopted++;
      return;
    }
    const data = {
      placeId,
      cemetery,
      graveKey: g.key,
      section: g.section,
      row: g.row,
      plotNumber: g.plotNumber,
      burials: g.burials,
      searchKeys: graveSearchKeys(g.burials),
      inscription: g.inscription,
      lat: g.lat,
      lng: g.lng,
      status: 'unclaimed',
      adoptedPlotId: null,
      source: 'import',
      createdByUid: 'import-script',
      updatedByUid: 'import-script',
      ...(prev.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      updatedAt: FieldValue.serverTimestamp(),
    };
    ops.push({ ref: refs[j], data, updateTime: prev.exists ? prev.updateTime : null });
  });
  const batch = db.batch();
  for (const op of ops) {
    if (op.updateTime) batch.update(op.ref, op.data, { lastUpdateTime: op.updateTime });
    else batch.create(op.ref, op.data);
  }
  try {
    await batch.commit();
    written += ops.length;
  } catch {
    for (const op of ops) {
      try {
        await db.runTransaction(async (tx) => {
          const cur = await tx.get(op.ref);
          if (cur.exists && cur.data().status === 'adopted') throw new Error('adopted');
          if (cur.exists) tx.update(op.ref, op.data);
          else tx.create(op.ref, op.data);
        });
        written++;
      } catch {
        keptAdopted++;
      }
    }
  }
}

await db.collection('auditEvents').add({
  entityType: 'graveRecord',
  entityId: placeId,
  action: 'register_imported',
  actorUid: 'import-script',
  details: { file, graves: written, burials: burialCount, keptAdopted },
  timestamp: FieldValue.serverTimestamp(),
});

console.log(`Wrote ${written} graves (${keptAdopted} already adopted, left alone).`);
process.exit(0);
