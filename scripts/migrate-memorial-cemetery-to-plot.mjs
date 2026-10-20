// One-off migration: move memorial.cemetery into a dedicated Plot doc.
//
// For every memorial that has cemetery.placeId:
//   - If memorial has no plotId: create a Plot (with cemetery) + an
//     auto-approved PlotMembership linking the memorial, then set
//     memorial.plotId.
//   - Clear memorial.cemetery (becomes the single source of truth on the
//     plot).
//
// Idempotent — safe to re-run; memorials without a cemetery are skipped.
//
// Usage (from the repo root):
//   node --env-file=.env.local scripts/migrate-memorial-cemetery-to-plot.mjs --dry
//   node --env-file=.env.local scripts/migrate-memorial-cemetery-to-plot.mjs

import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';

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

// Mirrors lib/ids.ts shortId — 8-char human-safe alphabet.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function shortId(length = 8) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

async function generateUniquePlotShortId(maxAttempts = 6) {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = shortId(8);
    const existing = await db
      .collection('plots')
      .where('shortId', '==', candidate)
      .limit(1)
      .get();
    if (existing.empty) return candidate;
  }
  throw new Error('Could not generate a unique plot short id');
}

async function main() {
  console.log(`Scanning memorials${DRY_RUN ? ' (dry run)' : ''}…`);
  const snap = await db.collection('memorials').get();

  const toProcess = [];
  let skippedNoCemetery = 0;
  let skippedAlreadyMigrated = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const cemetery = data.cemetery;
    const hasPlot = !!data.plotId;
    const hasCemetery = !!cemetery?.placeId;

    if (!hasCemetery && !hasPlot) {
      skippedNoCemetery += 1;
      continue;
    }
    if (!hasCemetery && hasPlot) {
      // Already migrated: cemetery cleared, plot linked. Skip.
      skippedAlreadyMigrated += 1;
      continue;
    }

    toProcess.push({
      id: docSnap.id,
      ownerId: data.ownerId,
      personId: data.personId || null,
      plotId: data.plotId || null,
      cemetery,
      fullName: data.fullName,
    });
  }

  console.log(
    `Scanned ${snap.size} memorials — ${skippedNoCemetery} no cemetery, ` +
      `${skippedAlreadyMigrated} already migrated, ${toProcess.length} to process.`,
  );

  if (DRY_RUN) {
    for (const row of toProcess.slice(0, 25)) {
      const action = row.plotId
        ? `clear cemetery (plot ${row.plotId} already linked)`
        : `create plot + membership, clear cemetery`;
      console.log(`  ${row.id} ("${row.fullName}") → ${action}`);
    }
    if (toProcess.length > 25) console.log(`  …and ${toProcess.length - 25} more`);
    return;
  }

  if (toProcess.length === 0) {
    console.log('Nothing to migrate. Done.');
    return;
  }

  let processed = 0;
  for (const row of toProcess) {
    try {
      let plotId = row.plotId;

      if (!plotId) {
        // 1. Create the plot with the memorial's cemetery.
        if (!row.ownerId) {
          console.warn(`  skip ${row.id} — missing ownerId`);
          continue;
        }
        const sId = await generateUniquePlotShortId();
        const plotRef = db.collection('plots').doc();
        plotId = plotRef.id;

        await plotRef.set({
          shortId: sId,
          cemetery: row.cemetery,
          plotAdminUids: [row.ownerId],
          plotAdminSuccessorUids: [],
          createdByUid: row.ownerId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // 2. Create an auto-approved PlotMembership.
        await db.collection('plotMemberships').add({
          plotId,
          memorialId: row.id,
          ...(row.personId ? { personId: row.personId } : {}),
          requestedByUid: row.ownerId,
          status: 'approved',
          approvedByUid: row.ownerId,
          approvedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      // 3. Point memorial at the plot and drop the denormalized cemetery.
      await db.collection('memorials').doc(row.id).update({
        plotId,
        cemetery: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      processed += 1;
      console.log(`  (${processed}/${toProcess.length}) ${row.id} → plot ${plotId}`);
    } catch (err) {
      console.error(`  failed ${row.id}:`, err);
    }
  }

  console.log(`Migration complete. Processed ${processed}/${toProcess.length}.`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
