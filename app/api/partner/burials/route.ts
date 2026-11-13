// POST /api/partner/burials — a funeral director's quick add to a cemetery
// register. Separate from starting a memorial (/partner/new), which places
// itself on the map its own way.
// { cemetery, section, row, plotNumber, forenames, surname, died, age,
//   address, familyName, familyEmail, familyConsent }
//
// Puts one person into the register: into the grave at that plot when one is
// already there (and no family has adopted it), otherwise into a new grave.
// The family contact is kept in familyContacts, which only the
// server can read, and never shown on the site.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { writeAuditAdmin } from '@/lib/audit-admin';
import { rateLimit } from '@/lib/rate-limit';
import { isApprovedPartner } from '@/lib/roles';
import { graveSearchKeys, normalise } from '@/lib/grave-match';
import { personKey, plotKey } from '@/lib/register-parse';
import {
  FAMILY_CONTACT_COLLECTION,
  FAMILY_CONTACT_CONSENT_TEXT,
  parseFamilyEmail,
} from '@/lib/family-contact';
import {
  GRAVE_COLLECTION,
  HttpError,
  MAX_BURIALS_PER_GRAVE,
  errorResponseBody,
  getCaller,
  parseCemetery,
  parseGraveInput,
  updateUnlessAdopted,
} from '@/lib/grave-records-admin';
import type { GraveBurial, GraveRecord, UserProfile } from '@/lib/types';

export const runtime = 'nodejs';

const PARTNER_DAILY_CAP = 100;

function str(v: unknown, max = 80): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// "135.0" from a spreadsheet and "135" typed by hand are the same plot.
function cleanPlot(v: unknown): string {
  return str(v, 30).replace(/^(\d+)\.0+$/, '$1');
}

function samePerson(a: GraveBurial, b: GraveBurial): boolean {
  return (
    normalise(a.surname) === normalise(b.surname) &&
    normalise(a.forenames || '') === normalise(b.forenames || '')
  );
}

export async function POST(req: NextRequest) {
  try {
    const caller = await getCaller(req.headers.get('Authorization'));
    const db = adminDb();
    const profSnap = await db.collection('users').doc(caller.uid).get();
    const profile = (profSnap.data() || null) as UserProfile | null;
    if (!caller.isSuperAdmin && !isApprovedPartner(profile)) {
      throw new HttpError(403, 'Only approved funeral directors and partners can do this.');
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const cemetery = parseCemetery(body.cemetery);
    if (!cemetery) throw new HttpError(400, 'Please choose the cemetery first.');

    let familyEmail = '';
    try {
      familyEmail = parseFamilyEmail(body.familyEmail);
    } catch {
      throw new HttpError(400, 'That family email address doesn’t look right. Please check it.');
    }
    const familyName = str(body.familyName, 120);
    const familyConsent = !!familyEmail && body.familyConsent === true;

    const section = str(body.section, 30);
    const row = str(body.row, 30);
    const plotNumber = cleanPlot(body.plotNumber);
    const input = parseGraveInput({
      section,
      row,
      plotNumber,
      burials: [
        {
          forenames: body.forenames,
          surname: body.surname,
          died: body.died,
          age: body.age,
          address: body.address,
        },
      ],
    });
    const burial = input.burials[0];

    if (!caller.isSuperAdmin) {
      const rl = await rateLimit(`partner-burial:${caller.uid}`, { max: PARTNER_DAILY_CAP, windowSec: 24 * 3600 });
      if (!rl.allowed) {
        throw new HttpError(429, `You’ve added ${PARTNER_DAILY_CAP} people today, which is our daily limit. Please carry on tomorrow.`);
      }
    }

    const personName = [burial.forenames, burial.surname].filter(Boolean).join(' ');
    const saveContact = async (graveId: string) => {
      if (!familyEmail) return;
      await db.collection(FAMILY_CONTACT_COLLECTION).add({
        email: familyEmail,
        name: familyName || null,
        marketingConsent: familyConsent,
        consentText: familyConsent ? FAMILY_CONTACT_CONSENT_TEXT : null,
        personName,
        died: burial.died || null,
        graveId,
        placeId: cemetery.placeId,
        cemeteryName: cemetery.name,
        partnerUid: caller.uid,
        partnerEmail: caller.email || null,
        createdAt: FieldValue.serverTimestamp(),
      });
    };

    const graves = db.collection(GRAVE_COLLECTION);
    let graveId = '';
    let outcome: 'added_to_grave' | 'new_grave' | 'already_there' = 'new_grave';

    if (plotNumber) {
      const key = plotKey(section, row, plotNumber);
      const hit = await graves.where('placeId', '==', cemetery.placeId).where('graveKey', '==', key).limit(1).get();
      if (!hit.empty) {
        const ref = hit.docs[0].ref;
        graveId = ref.id;
        let already = false;
        await updateUnlessAdopted(db, ref, (current: GraveRecord) => {
          const burials = current.burials || [];
          if (burials.some((b) => samePerson(b, burial))) {
            already = true;
            return {};
          }
          if (burials.length >= MAX_BURIALS_PER_GRAVE) {
            throw new HttpError(409, `That grave already has ${MAX_BURIALS_PER_GRAVE} names, which is the most we hold. Please check the plot number.`);
          }
          const next = [...burials, burial];
          return {
            burials: next,
            searchKeys: graveSearchKeys(next),
            updatedByUid: caller.uid,
            updatedAt: FieldValue.serverTimestamp(),
          };
        }).catch((err) => {
          if (err instanceof HttpError && err.status === 409 && !/names/.test(err.message)) {
            throw new HttpError(409, 'A family looks after this grave now, so we can’t add to it here. Please ask the family to add the name from their memorial.');
          }
          throw err;
        });
        outcome = already ? 'already_there' : 'added_to_grave';
      }
    }

    if (!graveId) {
      // New grave. With no plot number, the person's name is its identity, so
      // give a second person of the same name and year their own key.
      let graveKey = plotNumber ? plotKey(section, row, plotNumber) : personKey(burial);
      if (!plotNumber) {
        const base = graveKey;
        for (let n = 2; n < 50; n++) {
          const clash = await graves.where('placeId', '==', cemetery.placeId).where('graveKey', '==', graveKey).limit(1).get();
          if (clash.empty) break;
          graveKey = `${base}#${n}`;
        }
      }
      const ref = graves.doc();
      graveId = ref.id;
      await ref.set({
        placeId: cemetery.placeId,
        cemetery,
        ...input,
        graveKey,
        status: 'unclaimed',
        adoptedPlotId: null,
        source: 'partner',
        createdByUid: caller.uid,
        updatedByUid: caller.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await saveContact(graveId);

    await writeAuditAdmin({
      entityType: 'graveRecord',
      entityId: graveId,
      action: outcome === 'new_grave' ? 'created' : 'updated',
      actorUid: caller.uid,
      actorEmail: caller.email || undefined,
      details: { placeId: cemetery.placeId, via: 'partner_quick_add', outcome, familyContact: !!familyEmail },
    });

    return NextResponse.json({ graveId, outcome, personName });
  } catch (err) {
    const { status, error } = errorResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
