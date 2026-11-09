export function calculateAgeAtDeath(born?: string, died?: string): number | null {
  if (!born || !died) return null;
  const b = new Date(born);
  const d = new Date(died);
  if (isNaN(b.getTime()) || isNaN(d.getTime())) return null;
  if (d < b) return null;
  let age = d.getFullYear() - b.getFullYear();
  const beforeBirthdayInDeathYear =
    d.getMonth() < b.getMonth() ||
    (d.getMonth() === b.getMonth() && d.getDate() < b.getDate());
  if (beforeBirthdayInDeathYear) age -= 1;
  return age;
}

/**
 * Lossless single-line summary of what we know of the person's dates.
 * Picks the most informative form the data allows:
 *   born + died → "1948 — 2025"
 *   died only   → "Died 2025"
 *   born only   → "Born 1948"
 *   age only    → "Aged 77"
 *   nothing     → ""
 */
export function formatYears(
  born?: string,
  died?: string,
  ageAtDeath?: number | null,
): string {
  const b = born?.slice(0, 4);
  const d = died?.slice(0, 4);
  if (b && d) return `${b} — ${d}`;
  if (d) return `Died ${d}`;
  if (b) return `Born ${b}`;
  if (typeof ageAtDeath === 'number') return `Aged ${ageAtDeath}`;
  return '';
}
