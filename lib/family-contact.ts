// Wording shown beside the family contact email on the funeral director's
// quick add. Saved with each contact so we can show what they agreed to.
export const FAMILY_CONTACT_CONSENT_TEXT =
  'The family is happy for LiveOnWith.me to email them now and then about memorials. They can stop at any time.';

export const FAMILY_CONTACT_COLLECTION = 'familyContacts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trimmed, lower-cased email, or '' when blank. Throws on a bad address. */
export function parseFamilyEmail(raw: unknown): string {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase().slice(0, 200) : '';
  if (!v) return '';
  if (!EMAIL_RE.test(v)) throw new Error('bad-email');
  return v;
}
