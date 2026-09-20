// One-off backfill: populate `fullNameLower` on every memorial doc that's
// missing it, so the homepage name search can find pre-existing memorials.
// Idempotent — safe to re-run.
//
// Usage (from the repo root):
//   node --env-file=.env.local scripts/backfill-full-name-lower.mjs
//
// Add --dry to preview without writing:
//   node --env-file=.env.local scripts/backfill-full-name-lower.mjs --dry

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DRY_RUN = process.argv.includes('--dry');

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!projectId || !clientEmail || !privateKey) {
  console.error(
    'Missing Firebase Admin credentials. Set FIREBASE_ADMIN_PROJECT_ID, ' +
    'FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY in .env.local.',
  );
  process.exit(1);
}

initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

async function main() {
  console.log(`Scanning memorials collection${DRY_RUN ? ' (dry run)' : ''}…`);
  const snap = await db.collection('memorials').get();

  let scanned = 0;
  let toUpdate = [];
  let skippedNoName = 0;
  let alreadyFine = 0;

  for (const doc of snap.docs) {
    scanned += 1;
    const data = doc.data();
    const fullName = typeof data.fullName === 'string' ? data.fullName.trim() : '';
    if (!fullName) {
      skippedNoName += 1;
      continue;
    }
    const expected = fullName.toLowerCase();
    if (data.fullNameLower === expected) {
      alreadyFine += 1;
      continue;
    }
    toUpdate.push({ id: doc.id, fullName, fullNameLower: expected });
  }

  console.log(
    `Scanned ${scanned} memorials — ${alreadyFine} already have fullNameLower, ` +
    `${skippedNoName} missing fullName (skipped), ${toUpdate.length} to update.`,
  );

  if (DRY_RUN) {
    for (const row of toUpdate.slice(0, 20)) {
      console.log(`  would set: ${row.id} → "${row.fullNameLower}"`);
    }
    if (toUpdate.length > 20) console.log(`  …and ${toUpdate.length - 20} more`);
    return;
  }

  if (toUpdate.length === 0) {
    console.log('Nothing to backfill. Done.');
    return;
  }

  // Firestore batched writes are capped at 500 operations.
  const BATCH_SIZE = 400;
  let written = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const row of chunk) {
      batch.update(db.collection('memorials').doc(row.id), {
        fullNameLower: row.fullNameLower,
      });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  committed ${written} / ${toUpdate.length}`);
  }

  console.log(`Backfill complete. Updated ${written} memorials.`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
