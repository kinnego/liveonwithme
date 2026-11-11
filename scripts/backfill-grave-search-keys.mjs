// One-off: add `searchKeys` to grave records written before they existed.
// Safe to re-run; only records whose keys are missing or out of date are
// written, each only if no one changed it since it was read.
//
//   node --env-file=.env.local scripts/backfill-grave-search-keys.mjs [--dry]

import { graveSearchKeys } from '../lib/grave-match.ts';

const DRY = process.argv.includes('--dry');
const { cert, initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing Firebase Admin credentials (run with --env-file=.env.local).');
  process.exit(1);
}
initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

let seen = 0;
let fixed = 0;
let last = null;
for (;;) {
  let q = db.collection('graveRecords').orderBy('__name__').limit(400);
  if (last) q = q.startAfter(last);
  const snap = await q.get();
  if (snap.empty) break;
  const batch = db.batch();
  let n = 0;
  for (const d of snap.docs) {
    seen++;
    const want = graveSearchKeys(d.data().burials || []);
    const have = d.data().searchKeys;
    if (Array.isArray(have) && have.join('|') === want.join('|')) continue;
    batch.update(d.ref, { searchKeys: want }, { lastUpdateTime: d.updateTime });
    n++;
  }
  if (n && !DRY) await batch.commit();
  fixed += n;
  last = snap.docs[snap.docs.length - 1];
}
console.log(`${seen} graves checked, ${fixed} ${DRY ? 'need' : 'given'} search keys.`);
process.exit(0);
