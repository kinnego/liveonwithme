// Human-safe short ID generator: 8 chars from an unambiguous alphabet.
// Used for plot short IDs (/p/[shortId]) and custody transfer tokens.
//
// Alphabet skips 0/O/I/1/l to avoid transcription errors on printed material.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function shortId(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function longToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
