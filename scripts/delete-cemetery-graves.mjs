// Delete unadopted graveRecords (and optionally registerUploads) for one
// cemetery. "Unadopted" means no family has taken over the register entry
// into a memorial yet (adoptedPlotId is null/missing). Graves a family has
// adopted are always left alone — deleting those would orphan a live plot.
//
// Defaults to dry-run. Reports counts + a sample; pass --apply to really
// delete. --uploads also deletes matching registerUploads metadata.
//
// Usage (from the repo root):
//   node --env-file=.env.local scripts/delete-cemetery-graves.mjs \
//     --place-id ChIJM1P2vbYBYEgRhmWiI3BHXUE \
//     [--name "Carndonagh Cemetery"] \
//     [--apply] [--uploads]

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const placeId = arg('place-id');
const displayName = arg('name') || '(unnamed)';
const APPLY = process.argv.includes('--apply');
const WITH_UPLOADS = process.argv.includes('--uploads');

if (!placeId) {
  console.error('Usage: --place-id <placeId> [--name "Cemetery Name"] [--apply] [--uploads]');
  process.exit(1);
}

const { cert, initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY
  ?.replace(/^["']|["']$/g, '')
  .replace(/\\n/g, '\n');
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing Firebase Admin credentials (run with --env-file=.env.local).');
  process.exit(1);
}
initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

console.log(`Target cemetery: ${displayName} (${placeId})`);
console.log(`Firestore project: ${projectId}`);
console.log(`Mode: ${APPLY ? 'APPLY — will delete' : 'DRY RUN — no writes'}`);
console.log(`Uploads: ${WITH_UPLOADS ? 'will also delete registerUploads for this cemetery' : 'leave registerUploads alone'}`);
console.log('');

// ─── graves ──────────────────────────────────────────────────────────────────

const snap = await db.collection('graveRecords').where('placeId', '==', placeId).get();
const all = snap.docs;
const adopted = all.filter((d) => d.data().adoptedPlotId);
const unadopted = all.filter((d) => !d.data().adoptedPlotId);

console.log(`Found ${all.length} graveRecords for this cemetery.`);
console.log(`  • ${adopted.length} adopted (will be left alone).`);
console.log(`  • ${unadopted.length} unadopted (would be deleted).`);
console.log('');

if (unadopted.length > 0) {
  console.log('Sample of unadopted graves that would be deleted:');
  for (const d of unadopted.slice(0, 8)) {
    const g = d.data();
    const loc = [g.section, g.row, g.plotNumber].filter(Boolean).join('/') || '(no location)';
    const names = (g.burials || [])
      .map((b) => `${b.forenames || ''} ${b.surname || ''}`.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join('; ') || '(no names)';
    console.log(`  - ${loc} :: ${names}`);
  }
  if (unadopted.length > 8) console.log(`  …and ${unadopted.length - 8} more.`);
  console.log('');
}

// ─── uploads (optional) ──────────────────────────────────────────────────────

let uploadSnap = null;
if (WITH_UPLOADS) {
  uploadSnap = await db.collection('registerUploads').where('placeId', '==', placeId).get();
  console.log(`Found ${uploadSnap.size} registerUploads docs for this cemetery.`);
  console.log('');
}

if (!APPLY) {
  console.log('Dry run complete. Re-run with --apply to actually delete.');
  process.exit(0);
}

// ─── delete ──────────────────────────────────────────────────────────────────

async function batchDelete(refs) {
  let done = 0;
  for (let i = 0; i < refs.length; i += 400) {
    const chunk = refs.slice(i, i + 400);
    const batch = db.batch();
    for (const ref of chunk) batch.delete(ref);
    await batch.commit();
    done += chunk.length;
    process.stdout.write(`  …${done}/${refs.length}\r`);
  }
  if (refs.length) process.stdout.write('\n');
}

console.log(`Deleting ${unadopted.length} unadopted graves…`);
await batchDelete(unadopted.map((d) => d.ref));

if (WITH_UPLOADS && uploadSnap && uploadSnap.size > 0) {
  console.log(`Deleting ${uploadSnap.size} registerUploads…`);
  await batchDelete(uploadSnap.docs.map((d) => d.ref));
}

console.log('Done.');
