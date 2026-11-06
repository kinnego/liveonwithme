// Server-side shaper for contributions that cross the server/client boundary
// on the public memorial page. Two responsibilities:
//
//   1. Family-only memories are for keepers viewing the manage page, never
//      the public /m/[slug]. Previously the server shipped them all and the
//      client filtered — meaning anyone reading the HTML source or the
//      /api/memorial/view/<slug> JSON could read them. We drop here instead.
//
//   2. `contributorEmail` is PII the keeper uses for follow-ups; it never
//      renders on the public page. Strip before sending so view-source /
//      intercepted responses can't harvest them.

type ContributionRow = Record<string, any>;

export function publicContribution(raw: ContributionRow): ContributionRow | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.audience === 'family_only') return null;
  const safe = { ...raw };
  delete safe.contributorEmail;
  return safe;
}

export function publicContributions(rows: ContributionRow[]): ContributionRow[] {
  const out: ContributionRow[] = [];
  for (const row of rows) {
    const safe = publicContribution(row);
    if (safe) out.push(safe);
  }
  return out;
}
