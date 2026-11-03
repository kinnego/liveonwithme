// One-off backfill: generate `.400.webp` + `.800.webp` siblings in R2 for
// every memorial hero + contribution photo uploaded before the resize-on-
// upload pipeline landed. Flips `heroPhotoVariants` / `photoVariants` to
// true on the Firestore doc when the variants exist, so the public page
// switches to the smaller files. Idempotent — safe to re-run.
//
// Usage (from the repo root):
//   node --env-file=.env.local scripts/backfill-image-variants.mjs
//
// Add --dry to preview without writing:
//   node --env-file=.env.local scripts/backfill-image-variants.mjs --dry

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry');

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
const r2AccountId = process.env.R2_ACCOUNT_ID;
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const r2Bucket = process.env.R2_BUCKET_NAME;

if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing Firebase Admin credentials in .env.local.');
  process.exit(1);
}
if (!r2AccountId || !r2AccessKeyId || !r2SecretAccessKey || !r2Bucket) {
  console.error('Missing R2 credentials in .env.local.');
  process.exit(1);
}

initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey },
});

const VARIANT_WIDTHS = [400, 800];
const VARIANT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function extToMime(key) {
  const ext = key.toLowerCase().split('.').pop() || '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return null;
}

async function downloadFromR2(key) {
  const res = await r2.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }));
  const stream = res.Body;
  if (!stream) return null;
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  const mimeType = res.ContentType || extToMime(key) || 'image/jpeg';
  return { buffer, mimeType };
}

async function generateVariants(originalKey, buffer, mimeType) {
  if (!VARIANT_MIME_TYPES.has(mimeType)) return false;
  const probe = sharp(buffer, { failOn: 'none' });
  const metadata = await probe.metadata();
  const sourceWidth = metadata.width ?? 0;
  if (sourceWidth < VARIANT_WIDTHS[0]) return false;

  await Promise.all(
    VARIANT_WIDTHS.map(async (width) => {
      const resized = await sharp(buffer, { failOn: 'none' })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      await r2.send(
        new PutObjectCommand({
          Bucket: r2Bucket,
          Key: `${originalKey}.${width}.webp`,
          Body: resized,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    }),
  );
  return true;
}

async function processCollection({ name, pathField, variantsField }) {
  console.log(`\n→ ${name}${DRY_RUN ? ' (dry run)' : ''}`);
  const snap = await db.collection(name).get();
  let scanned = 0;
  let updated = 0;
  let alreadyDone = 0;
  let noPath = 0;
  let unsupported = 0;
  let failed = 0;

  for (const doc of snap.docs) {
    scanned += 1;
    const data = doc.data();
    const path = data[pathField];

    if (!path) {
      noPath += 1;
      continue;
    }
    if (data[variantsField] === true) {
      alreadyDone += 1;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  would backfill: ${doc.id} (${path})`);
      updated += 1;
      continue;
    }

    try {
      const dl = await downloadFromR2(path);
      if (!dl) {
        console.log(`  download empty: ${doc.id} (${path})`);
        failed += 1;
        continue;
      }
      const ok = await generateVariants(path, dl.buffer, dl.mimeType);
      if (!ok) {
        console.log(`  unsupported: ${doc.id} (${dl.mimeType})`);
        await doc.ref.update({
          [variantsField]: false,
          variantsBackfilledAt: FieldValue.serverTimestamp(),
        });
        unsupported += 1;
        continue;
      }
      await doc.ref.update({
        [variantsField]: true,
        variantsBackfilledAt: FieldValue.serverTimestamp(),
      });
      console.log(`  ✓ ${doc.id}`);
      updated += 1;
    } catch (err) {
      console.log(`  ✕ ${doc.id} — ${err.message || err}`);
      failed += 1;
    }
  }

  console.log(
    `${name}: scanned ${scanned} · updated ${updated} · already-done ${alreadyDone} · ` +
      `no-path ${noPath} · unsupported ${unsupported} · failed ${failed}`,
  );
}

async function main() {
  await processCollection({
    name: 'memorials',
    pathField: 'heroPhotoPath',
    variantsField: 'heroPhotoVariants',
  });
  await processCollection({
    name: 'contributions',
    pathField: 'photoPath',
    variantsField: 'photoVariants',
  });
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
