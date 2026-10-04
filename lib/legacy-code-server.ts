// Server-only pieces of the legacy claim-code module. Keeps node:crypto out
// of client bundles.

import { createHash, randomBytes } from 'node:crypto';
import {
  LEGACY_CODE_ALPHABET,
  LEGACY_CODE_LENGTH,
  formatLegacyCode,
  normalizeLegacyCode,
} from './legacy-code';

/** Generate a formatted 20-character claim code, e.g. "K7J2A-9H4QR-8MXWZ-3LPNT". */
export function generateLegacyCode(): string {
  const bytes = randomBytes(LEGACY_CODE_LENGTH);
  let raw = '';
  for (let i = 0; i < LEGACY_CODE_LENGTH; i++) {
    raw += LEGACY_CODE_ALPHABET[bytes[i] % LEGACY_CODE_ALPHABET.length];
  }
  return formatLegacyCode(raw);
}

/** SHA-256 hex digest of the normalized code. */
export function hashLegacyCode(code: string): string {
  return createHash('sha256').update(normalizeLegacyCode(code)).digest('hex');
}
