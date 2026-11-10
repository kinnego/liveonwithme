// Import a parish burial register (spreadsheet saved as CSV) into the
// private `graveRecords` collection, then rebuild the cemetery's match index.
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
// Column headers are matched loosely (case and spacing don't matter):
//   section | row | plot (or "plot number", "grave", "grave no")
//   surname (or "last name")   forenames (or "first name", "first names", "forename", "christian name")
//   died (or "date of death", "death", "year")   age   notes   inscription   lat   lng
// See scripts/grave-register-template.csv.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { graveLabel, toIndexBurial, yearOf } from '../lib/grave-match.ts';

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

// ─── CSV ─────────────────────────────────────────────────────────────────────

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const HEADER_ALIASES = {
  section: ['section', 'sect', 'area'],
  row: ['row'],
  plotNumber: ['plot', 'plotnumber', 'plotno', 'grave', 'graveno', 'gravenumber', 'number', 'no'],
  surname: ['surname', 'lastname', 'familyname'],
  forenames: ['forenames', 'forename', 'firstname', 'firstnames', 'christianname', 'givenname', 'givennames'],
  died: ['died', 'dateofdeath', 'death', 'dod', 'year', 'yearofdeath', 'dateofburial', 'burialdate'],
  age: ['age'],
  notes: ['notes', 'note', 'remarks', 'address', 'townland'],
  inscription: ['inscription', 'headstone'],
  lat: ['lat', 'latitude'],
  lng: ['lng', 'lon', 'long', 'longitude'],
};

function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = h.toLowerCase().replace(/[^a-z]/g, '');
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key) && map[field] === undefined) map[field] = i;
    }
  });
  if (map.surname === undefined) {
    console.error(`No surname column found. Headers were: ${headerRow.join(', ')}`);
    process.exit(1);
  }
  return map;
}

// ─── group rows into graves ──────────────────────────────────────────────────

const rows = parseCsv(readFileSync(file, 'utf8'));
const cols = mapHeaders(rows[0]);
const get = (r, f) => (cols[f] === undefined ? '' : String(r[cols[f]] ?? '').trim());

const graves = new Map();
let burialCount = 0;
let skipped = 0;
rows.slice(1).forEach((r, i) => {
  const surname = get(r, 'surname');
  if (!surname) {
    skipped++;
    return;
  }
  const section = get(r, 'section');
  const row = get(r, 'row');
  const plotNumber = get(r, 'plotNumber');
  const key = plotNumber
    ? `${placeId}|${section.toLowerCase()}|${row.toLowerCase()}|${plotNumber.toLowerCase()}`
    : `${placeId}|line|${i + 2}`;
  if (!graves.has(key)) {
    graves.set(key, { section, row, plotNumber, burials: [], inscription: '', lat: null, lng: null });
  }
  const g = graves.get(key);
  const died = get(r, 'died');
  const burial = { surname, diedYear: yearOf(died) };
  const forenames = get(r, 'forenames');
  if (forenames) burial.forenames = forenames;
  if (died) burial.died = died;
  const age = get(r, 'age');
  if (age) burial.age = age;
  const notes = get(r, 'notes');
  if (notes) burial.notes = notes;
  g.burials.push(burial);
  burialCount++;
  const inscription = get(r, 'inscription');
  if (inscription && !g.inscription) g.inscription = inscription;
  const lat = Number(get(r, 'lat'));
  const lng = Number(get(r, 'lng'));
  if (get(r, 'lat') && get(r, 'lng') && Number.isFinite(lat) && Number.isFinite(lng)) {
    g.lat = lat;
    g.lng = lng;
  }
});

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

let written = 0;
let keptAdopted = 0;
const entries = [...graves.entries()];
for (let i = 0; i < entries.length; i += 200) {
  const chunk = entries.slice(i, i + 200);
  const refs = chunk.map(([key]) => db.collection('graveRecords').doc(docIdOf(key)));
  const existing = await db.getAll(...refs);
  const batch = db.batch();
  chunk.forEach(([, g], j) => {
    const prev = existing[j];
    if (prev.exists && prev.data().status === 'adopted') {
      keptAdopted++;
      return;
    }
    batch.set(refs[j], {
      placeId,
      cemetery,
      section: g.section,
      row: g.row,
      plotNumber: g.plotNumber,
      burials: g.burials,
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
    }, { merge: true });
    written++;
  });
  await batch.commit();
}

// Rebuild the match index (mirrors rebuildGraveIndex in lib/grave-records-admin.ts).
const all = await db.collection('graveRecords').where('placeId', '==', placeId).get();
const indexEntries = all.docs.map((d) => {
  const g = d.data();
  return {
    id: d.id,
    l: graveLabel(g),
    b: (g.burials || []).map((b) => toIndexBurial({ surname: b.surname, forenames: b.forenames, diedYear: b.diedYear ?? null })),
    a: g.status === 'adopted',
    p: g.adoptedPlotId ?? null,
    g: typeof g.lat === 'number' && typeof g.lng === 'number',
  };
});
await db.collection('graveIndex').doc(placeId).set({
  placeId,
  entries: indexEntries,
  count: indexEntries.length,
  updatedAt: new Date(),
});

await db.collection('auditEvents').add({
  entityType: 'graveRecord',
  entityId: placeId,
  action: 'register_imported',
  actorUid: 'import-script',
  details: { file, graves: written, burials: burialCount, keptAdopted },
  timestamp: FieldValue.serverTimestamp(),
});

console.log(`Wrote ${written} graves (${keptAdopted} already adopted, left alone). Index now holds ${indexEntries.length} graves.`);
process.exit(0);
