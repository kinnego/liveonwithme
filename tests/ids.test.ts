import { describe, it, expect } from 'vitest';
import { shortId, longToken, slugify } from '@/lib/ids';

const UNAMBIGUOUS = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/;

describe('shortId', () => {
  it('returns default length of 8', () => {
    expect(shortId()).toHaveLength(8);
  });

  it('respects custom length', () => {
    expect(shortId(12)).toHaveLength(12);
    expect(shortId(4)).toHaveLength(4);
  });

  it('uses only the unambiguous alphabet (no 0/O/I/1/l)', () => {
    for (let i = 0; i < 100; i++) {
      expect(shortId(16)).toMatch(UNAMBIGUOUS);
    }
  });

  it('produces different values across calls (statistical, non-flaky)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(shortId());
    // At 31^8 combinations, 200 draws collide with vanishingly small probability.
    expect(seen.size).toBeGreaterThan(195);
  });
});

describe('longToken', () => {
  it('returns hex of 2 × length', () => {
    expect(longToken(32)).toHaveLength(64);
    expect(longToken(16)).toHaveLength(32);
  });

  it('is lowercase hex only', () => {
    expect(longToken(32)).toMatch(/^[0-9a-f]+$/);
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Mary O Donnell')).toBe('mary-o-donnell');
  });

  it('strips accents', () => {
    expect(slugify('Séamus Ó Néill')).toBe('seamus-o-neill');
  });

  it('trims edge hyphens', () => {
    expect(slugify('  Hello, world!  ')).toBe('hello-world');
  });

  it('collapses runs of non-alphanumerics', () => {
    expect(slugify('a---b___c')).toBe('a-b-c');
  });

  it('returns empty string for all-symbol input', () => {
    expect(slugify('***')).toBe('');
  });
});
