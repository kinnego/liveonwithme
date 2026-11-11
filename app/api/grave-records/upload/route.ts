// POST /api/grave-records/upload
//   { cemetery, fileName, text, mode: 'add_and_update' | 'add_only', preview }
//
// A registrar uploads a spreadsheet of their burial register (CSV, or a
// table pasted from Excel / ChatGPT). With `preview: true` nothing is
// written: we return what would happen so they can check it first.
//
// A grave in the sheet matches an existing one by section + row + plot
// number, or (when there's no plot number) by the first person's name and
// year of death. The registrar chooses what happens to matches:
//   add_and_update — matching graves are replaced by the sheet's version
//   add_only       — matching graves are left alone; only new ones are added
// Graves a family has adopted are never changed by an upload.
// The original text is kept so the registrar can download it again.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, type Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { rateLimit } from '@/lib/rate-limit';
import { graveLabel, graveSearchKeys } from '@/lib/grave-match';
import { graveKeyOf, parseRegister, type ParsedGrave } from '@/lib/register-parse';
import {
  GRAVE_COLLECTION,
  HttpError,
  UPLOAD_COLLECTION,
  errorResponseBody,
  getCaller,
  parseCemetery,
  updateUnlessAdopted,
  requireRegistrar,
} from '@/lib/grave-records-admin';
import type { GraveRecord, RegisterUploadMode } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Firestore docs max out at 1 MiB; keep the stored copy comfortably under.
const MAX_TEXT_BYTES = 800 * 1024;

/** Id for a grave added by upload: the same sheet row always gets the same id. */
function uploadedGraveId(placeId: string, graveKey: string): string {
  return `upl_${createHash('sha1').update(`${placeId}|${graveKey}`).digest('hex').slice(0, 20)}`;
}

type Plan =
  | { kind: 'add'; grave: ParsedGrave }
  | { kind: 'update'; grave: ParsedGrave; id: string; existing: GraveRecord; updateTime: Timestamp }
  | { kind: 'skip'; grave: ParsedGrave; reason: 'adopted' | 'exists' };

export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const body = await req.json().catch(() => ({}));
    const cemetery = parseCemetery(body?.cemetery);
    if (!cemetery) throw new HttpError(400, 'Cemetery details are missing.');
    const text = typeof body?.text === 'string' ? body.text : '';
    const fileName = (typeof body?.fileName === 'string' && body.fileName.trim().slice(0, 120)) || 'Pasted table';
    const mode: RegisterUploadMode = body?.mode === 'add_only' ? 'add_only' : 'add_and_update';
    const preview = body?.preview === true;
    if (!text.trim()) throw new HttpError(400, 'The file is empty.');
    if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
      throw new HttpError(413, 'That file is too big to upload in one go. Please split it into two or more sheets.');
    }

    const db = adminDb();
    await requireRegistrar(db, caller, cemetery.placeId);

    if (!caller.isSuperAdmin) {
      const rl = preview
        ? await rateLimit(`grave-upload-preview:${caller.uid}`, { max: 60, windowSec: 3600 })
        : await rateLimit(`grave-upload:${caller.uid}`, { max: 10, windowSec: 24 * 3600 });
      if (!rl.allowed) throw new HttpError(429, 'That’s a lot of uploads for one day. Please try again tomorrow.');
    }

    const parsed = parseRegister(text);
    if (parsed.error) throw new HttpError(400, parsed.error);

    // Index the cemetery's existing graves by identity.
    const existingSnap = await db.collection(GRAVE_COLLECTION).where('placeId', '==', cemetery.placeId).get();
    const byKey = new Map<string, { id: string; data: GraveRecord; updateTime: Timestamp }>();
    for (const d of existingSnap.docs) {
      const data = d.data() as GraveRecord;
      const key = data.graveKey || graveKeyOf(data);
      if (key && !byKey.has(key)) byKey.set(key, { id: d.id, data, updateTime: d.updateTime });
    }

    const plan: Plan[] = parsed.graves.map((grave) => {
      const hit = byKey.get(grave.key);
      if (!hit) return { kind: 'add', grave };
      if (hit.data.status === 'adopted') return { kind: 'skip', grave, reason: 'adopted' };
      if (mode === 'add_only') return { kind: 'skip', grave, reason: 'exists' };
      return { kind: 'update', grave, id: hit.id, existing: hit.data, updateTime: hit.updateTime };
    });

    const added = plan.filter((p) => p.kind === 'add').length;
    const updates = plan.filter((p): p is Extract<Plan, { kind: 'update' }> => p.kind === 'update');
    const skippedAdopted = plan.filter((p) => p.kind === 'skip' && p.reason === 'adopted').length;
    const skippedExisting = plan.filter((p) => p.kind === 'skip' && p.reason === 'exists').length;
    const summary = {
      people: parsed.people,
      graves: parsed.graves.length,
      added,
      updated: updates.length,
      handEditedOverwritten: updates.filter((u) => u.existing.editedByHand).length,
      skippedAdopted,
      skippedExisting,
      skippedRows: parsed.skippedRows,
      uncertainCells: parsed.uncertainCells,
      columns: parsed.columns,
      unknownHeaders: parsed.unknownHeaders,
      matchedExisting: plan.filter((p) => p.kind !== 'add').length,
      sample: parsed.graves.slice(0, 5).map((g) => ({
        label: graveLabel(g),
        names: g.burials.map((b) => [b.forenames, b.surname].filter(Boolean).join(' ') + (b.died ? ` (${b.died})` : '')),
      })),
    };

    if (preview) return NextResponse.json({ preview: true, summary });

    // ─── commit ───────────────────────────────────────────────────────────────
    const uploadRef = db.collection(UPLOAD_COLLECTION).doc();
    await uploadRef.set({
      placeId: cemetery.placeId,
      fileName,
      mode,
      uploadedByUid: caller.uid,
      uploadedByEmail: caller.email || null,
      people: summary.people,
      graves: summary.graves,
      added: summary.added,
      updated: summary.updated,
      skipped: skippedAdopted + skippedExisting,
      uncertainCells: summary.uncertainCells,
      text,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Writes go in batches. Each update carries the record's update time
    // from when we read it, and each new grave gets an id derived from its
    // identity, so a batch fails rather than clobbering anything that
    // changed meanwhile: a family adopting a grave, a registrar's edit, or a
    // second upload of the same sheet. A failed batch is then redone one
    // write at a time, re-checking each grave, and lost races are skipped.
    const writes = plan.filter((p): p is Exclude<Plan, { kind: 'skip' }> => p.kind !== 'skip');
    let raced = 0;
    for (let i = 0; i < writes.length; i += 400) {
      const chunk = writes.slice(i, i + 400).map((p) => {
        const g = p.grave;
        const common = {
          graveKey: g.key,
          section: g.section,
          row: g.row,
          plotNumber: g.plotNumber,
          burials: g.burials,
          searchKeys: graveSearchKeys(g.burials),
          uploadId: uploadRef.id,
          updatedByUid: caller.uid,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (p.kind === 'add') {
          return {
            p,
            ref: db.collection(GRAVE_COLLECTION).doc(uploadedGraveId(cemetery.placeId, g.key)),
            data: {
              ...common,
              placeId: cemetery.placeId,
              cemetery,
              inscription: g.inscription,
              lat: g.lat,
              lng: g.lng,
              status: 'unclaimed',
              adoptedPlotId: null,
              source: 'upload',
              editedByHand: false,
              createdByUid: caller.uid,
              createdAt: FieldValue.serverTimestamp(),
            } as Record<string, unknown>,
          };
        }
        // The sheet wins for names and dates. Keep what the sheet doesn't
        // have: an inscription or a pin added since.
        return {
          p,
          ref: db.collection(GRAVE_COLLECTION).doc(p.id),
          data: {
            ...common,
            inscription: g.inscription || p.existing.inscription || '',
            lat: g.lat ?? p.existing.lat ?? null,
            lng: g.lng ?? p.existing.lng ?? null,
            editedByHand: false,
          } as Record<string, unknown>,
        };
      });

      const batch = db.batch();
      for (const w of chunk) {
        if (w.p.kind === 'add') batch.create(w.ref, w.data);
        else batch.update(w.ref, w.data, { lastUpdateTime: w.p.updateTime });
      }
      try {
        await batch.commit();
      } catch {
        for (const w of chunk) {
          try {
            if (w.p.kind === 'add') await w.ref.create(w.data);
            else await updateUnlessAdopted(db, w.ref, w.data);
          } catch {
            raced++;
          }
        }
      }
    }
    if (raced) summary.skippedAdopted += raced;

    await writeAuditAdmin({
      entityType: 'graveRecord',
      entityId: uploadRef.id,
      action: 'register_uploaded',
      actorUid: caller.uid,
      actorEmail: caller.email || undefined,
      details: { placeId: cemetery.placeId, fileName, mode, added, updated: updates.length, skippedDuringWrite: raced },
    });

    return NextResponse.json({ ok: true, uploadId: uploadRef.id, summary });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
