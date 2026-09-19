import { describe, it, expect } from 'vitest';
import { calculateAgeAtDeath } from '@/lib/age';

describe('calculateAgeAtDeath', () => {
  it('returns null when either date is missing', () => {
    expect(calculateAgeAtDeath()).toBeNull();
    expect(calculateAgeAtDeath('1950-01-01')).toBeNull();
    expect(calculateAgeAtDeath(undefined, '2020-01-01')).toBeNull();
  });

  it('returns null when dates are malformed', () => {
    expect(calculateAgeAtDeath('not-a-date', '2020-01-01')).toBeNull();
    expect(calculateAgeAtDeath('1950-01-01', 'oops')).toBeNull();
  });

  it('returns null when death predates birth', () => {
    expect(calculateAgeAtDeath('2020-01-01', '1990-01-01')).toBeNull();
  });

  it('handles the exact-birthday case (age counted on the day)', () => {
    expect(calculateAgeAtDeath('1950-06-15', '2020-06-15')).toBe(70);
  });

  it('subtracts a year when death is before that year’s birthday', () => {
    expect(calculateAgeAtDeath('1950-06-15', '2020-06-14')).toBe(69);
    expect(calculateAgeAtDeath('1950-06-15', '2020-01-01')).toBe(69);
  });

  it('does not subtract when death is after that year’s birthday', () => {
    expect(calculateAgeAtDeath('1950-06-15', '2020-06-16')).toBe(70);
    expect(calculateAgeAtDeath('1950-06-15', '2020-12-31')).toBe(70);
  });

  it('handles leap-day births sensibly', () => {
    expect(calculateAgeAtDeath('2000-02-29', '2020-02-28')).toBe(19);
    expect(calculateAgeAtDeath('2000-02-29', '2020-03-01')).toBe(20);
  });
});
