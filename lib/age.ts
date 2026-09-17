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
