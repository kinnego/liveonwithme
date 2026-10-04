// Legacy claim code — a one-time passphrase that an owner of a self-managed
// memorial (kind === 'legacy') prints and stores with their important papers.
// Presenting the code (plus a signed-in LiveOnWith.me account) transfers
// custody immediately — no cooldown, no email verification. The code itself
// is the gate.
//
// This module is client-safe (no node:crypto). Server-side generation and
// hashing live in `lib/legacy-code-server.ts`.
//
// Alphabet is the same unambiguous Crockford-ish set we use for plot short
// IDs (lib/ids.ts): no 0/O/I/1/L. 20 characters at base-31 gives ~99 bits of
// entropy — printable on a single line, still astronomically hard to guess.

export const LEGACY_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LEGACY_CODE_LENGTH = 20;
export const LEGACY_CODE_GROUP_SIZE = 5;

/** Insert a dash every five characters. Accepts raw or already-formatted input. */
export function formatLegacyCode(input: string): string {
  const raw = input.replace(/-/g, '');
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += LEGACY_CODE_GROUP_SIZE) {
    groups.push(raw.slice(i, i + LEGACY_CODE_GROUP_SIZE));
  }
  return groups.join('-');
}

/**
 * Collapse user input to the canonical form: uppercase, A-Z/0-9 only, no
 * separators. The hash is computed on this canonical form so dashes, spaces,
 * and casing in the printed letter don't matter when someone types it in.
 */
export function normalizeLegacyCode(input: string): string {
  return (input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The last five characters, surfaced to the owner so they can tell which code
 *  is currently active without us ever having to show them the full value again. */
export function hintFromCode(code: string): string {
  const canonical = normalizeLegacyCode(code);
  return canonical.slice(-LEGACY_CODE_GROUP_SIZE);
}
