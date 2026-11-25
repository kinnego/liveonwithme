import { adminDb } from './firebase-admin';
import { slugify } from './ids';

// URL path names already taken under /partner — a slug equal to one of these
// would silently shadow the real route, so we reject them at claim time.
const RESERVED_SLUGS = new Set(['apply', 'new', 'register', 'referrals']);

const MIN_LEN = 3;
const MAX_LEN = 40;

export type SlugValidation =
  | { ok: true; slug: string }
  | { ok: false; reason: 'empty' | 'tooShort' | 'tooLong' | 'invalidChars' | 'reserved' };

export function validateSlug(input: string): SlugValidation {
  const slug = input.trim().toLowerCase();
  if (!slug) return { ok: false, reason: 'empty' };
  if (slug.length < MIN_LEN) return { ok: false, reason: 'tooShort' };
  if (slug.length > MAX_LEN) return { ok: false, reason: 'tooLong' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { ok: false, reason: 'invalidChars' };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'reserved' };
  return { ok: true, slug };
}

export function slugErrorMessage(reason: Exclude<SlugValidation, { ok: true }>['reason']): string {
  switch (reason) {
    case 'empty':
      return 'Please choose a URL name.';
    case 'tooShort':
      return `URL name must be at least ${MIN_LEN} characters.`;
    case 'tooLong':
      return `URL name can be at most ${MAX_LEN} characters.`;
    case 'invalidChars':
      return 'URL name can only use lowercase letters, numbers, and hyphens — no leading or trailing hyphen.';
    case 'reserved':
      return 'That URL name is reserved.';
  }
}

/**
 * Claim `slug` for `uid`, releasing any previous slug they held. Returns the
 * final slug (always equal to the requested one — collisions throw). Runs in
 * a single transaction so two partners racing on the same slug can't both win.
 */
export async function claimSlug(uid: string, requested: string): Promise<string> {
  const v = validateSlug(requested);
  if (!v.ok) throw new Error(slugErrorMessage(v.reason));
  const slug = v.slug;

  const db = adminDb();
  const slugRef = db.collection('partnerSlugs').doc(slug);
  const userRef = db.collection('users').doc(uid);

  await db.runTransaction(async (tx) => {
    const [slugSnap, userSnap] = await Promise.all([tx.get(slugRef), tx.get(userRef)]);

    if (slugSnap.exists && slugSnap.data()?.uid !== uid) {
      throw new Error('That URL name is taken. Please pick another.');
    }
    if (!userSnap.exists) {
      throw new Error('Profile not found.');
    }
    const prevSlug = userSnap.data()?.partnerSlug as string | undefined;
    const now = new Date();

    tx.set(slugRef, {
      uid,
      reservedAt: slugSnap.exists ? slugSnap.data()?.reservedAt ?? now : now,
      updatedAt: now,
    });
    tx.update(userRef, { partnerSlug: slug });
    if (prevSlug && prevSlug !== slug) {
      tx.delete(db.collection('partnerSlugs').doc(prevSlug));
    }
  });

  return slug;
}

/**
 * Claim a slug based on `preferred` (usually a business name), trying variants
 * until one is free. Used on partner approval and for backfill. Never throws
 * on collision — just appends a short suffix.
 */
export async function claimSlugWithFallback(uid: string, preferred: string): Promise<string> {
  const base = slugify(preferred).slice(0, MAX_LEN - 6) || 'partner';
  const candidates = [base];
  for (let i = 0; i < 5; i++) {
    candidates.push(`${base}-${Math.random().toString(36).slice(2, 6)}`);
  }
  for (const candidate of candidates) {
    const v = validateSlug(candidate);
    if (!v.ok) continue;
    try {
      return await claimSlug(uid, candidate);
    } catch {
      // try the next variant
    }
  }
  // Last-ditch: a fully random slug can't collide with a business-name variant
  // and will satisfy MIN_LEN since the suffix is 6 chars.
  return claimSlug(uid, `partner-${Math.random().toString(36).slice(2, 8)}`);
}
