// Fuzzy matching of a loved one's name against a cemetery's burial register.
//
// Pure, dependency-free module: it's imported by the API routes, by the
// register import script (run directly with Node's type stripping, so keep
// to erasable TypeScript only: no enums, no `@/` imports) and by tests.
//
// Matching is deliberately conservative. A suggestion is only ever shown to
// a family as "Could this be…?" and nothing is claimed without their yes,
// but too many wrong suggestions would erode trust, so the surname has to
// match closely and a clearly conflicting death year rules a burial out.

// ─── Index shape ─────────────────────────────────────────────────────────────
// One `graveIndex/{placeId}` doc per cemetery holds a compact entry per
// grave, so a suggestion costs a single Firestore read. Keys are kept short
// because the whole cemetery has to fit in one 1 MiB document.

export interface GraveIndexBurial {
  /** Normalised surname key. */
  s: string;
  /** Normalised forename keys (each name expanded to its canonical form). */
  f: string[];
  /** Year of death, if known. */
  y: number | null;
  /** Display name, as written in the register. */
  n: string;
}

export interface GraveIndexEntry {
  /** graveRecords doc id. */
  id: string;
  /** Human label, e.g. "Section A · Row C · Plot 12". */
  l: string;
  b: GraveIndexBurial[];
  /** True once a family has adopted the grave. */
  a: boolean;
  /** Plot id when adopted. */
  p: string | null;
  /** True when the grave has a map pin. */
  g: boolean;
}

export interface GraveBurialInput {
  surname: string;
  forenames?: string;
  diedYear?: number | null;
}

// ─── Normalisation ───────────────────────────────────────────────────────────

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalise(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Irish/Scottish surname prefixes. Registers mix "McGinley", "Mc Ginley",
// "MacGinley", "Mag Fhionnghaile" etc; "O'Donnell", "O Donnell" and
// "Ó Dónaill". We drop the prefix for the key so every form lands together.
const SURNAME_PREFIXES = new Set(['mac', 'mc', 'mag', 'o', 'ui', 'ni', 'nic', 'ua']);

// Common Irish-language ↔ English surname pairs seen in Donegal registers.
// Keys are prefix-stripped normalised forms.
const SURNAME_EQUIVALENTS: Record<string, string> = {
  domhnaill: 'donnell',
  dhomhnaill: 'donnell',
  donaill: 'donnell',
  dhonaill: 'donnell',
  gallchobhair: 'gallagher',
  gallchoir: 'gallagher',
  bhaoill: 'boyle',
  baoill: 'boyle',
  dochartaigh: 'doherty',
  dhochartaigh: 'doherty',
  fhionnghaile: 'ginley',
  suibhne: 'sweeney',
  shuibhne: 'sweeney',
  gilliosa: 'gillespie',
  'ghiolla easpaig': 'gillespie',
  'giolla easpaig': 'gillespie',
  bradaigh: 'brady',
  cathain: 'kane',
  chathain: 'kane',
  ceallaigh: 'kelly',
  cheallaigh: 'kelly',
  murchu: 'murphy',
  mhurchu: 'murphy',
  briain: 'brien',
  bhriain: 'brien',
};

// Spelling variants that should collapse together.
const SURNAME_VARIANTS: Record<string, string> = {
  gallacher: 'gallagher',
  gallaher: 'gallagher',
  docherty: 'doherty',
  dougherty: 'doherty',
  gilespie: 'gillespie',
  bryne: 'byrne',
};

export function surnameKey(surname: string): string {
  const parts = normalise(surname).split(' ').filter(Boolean);
  if (parts.length === 0) return '';
  let rest = parts;
  if (rest.length > 1 && SURNAME_PREFIXES.has(rest[0])) rest = rest.slice(1);
  let joined = rest.join(' ');
  // Glued prefixes: "mcginley", "macginley", "oneill".
  if (rest.length === 1) {
    const w = rest[0];
    // "mac" glued on is ambiguous (Macken, Mackey, Macklin are surnames in
    // their own right), so only strip it before a non-k remainder of 4+.
    if (w.startsWith('mac') && w.length >= 7 && w[3] !== 'k') joined = w.slice(3);
    else if (w.startsWith('mc') && w.length > 4) joined = w.slice(2);
  }
  joined = SURNAME_EQUIVALENTS[joined] ?? joined;
  joined = joined.replace(/\s+/g, '');
  // Glued "oneill" / "odonnell" only after the equivalence lookup, so a
  // genuine surname starting with "o" (e.g. "owens") isn't mangled.
  if (/^o(donnell|neill|brien|doherty|boyle|kane|kelly|connor|sullivan|reilly|hara|shea|toole|rourke|callaghan)$/.test(joined)) {
    joined = joined.slice(1);
  }
  return SURNAME_VARIANTS[joined] ?? joined;
}

// Nicknames and Irish-language forenames mapped to one canonical form.
const FORENAME_CANON: Record<string, string> = {
  paddy: 'patrick', pat: 'patrick', padraig: 'patrick', padraic: 'patrick', paudie: 'patrick', patk: 'patrick',
  biddy: 'bridget', bridie: 'bridget', brid: 'bridget', brigid: 'bridget', bride: 'bridget', bridgid: 'bridget',
  maire: 'mary', mai: 'mary', molly: 'mary', maura: 'mary', mamie: 'mary', may: 'mary',
  sean: 'john', johnny: 'john', jack: 'john', eoin: 'john', jno: 'john',
  seamus: 'james', jim: 'james', jimmy: 'james', jas: 'james', jamesie: 'james',
  mick: 'michael', mickey: 'michael', micky: 'michael', mihal: 'michael', micheal: 'michael', mich: 'michael',
  hugh: 'hugh', aodh: 'hugh', hughie: 'hugh',
  danny: 'daniel', dan: 'daniel', donal: 'daniel', domhnall: 'daniel',
  con: 'cornelius', connie: 'cornelius', conal: 'conall',
  peggy: 'margaret', maggie: 'margaret', peig: 'margaret', mairead: 'margaret', madge: 'margaret', margt: 'margaret',
  kate: 'catherine', katie: 'catherine', kathleen: 'catherine', caitlin: 'catherine', cait: 'catherine', katherine: 'catherine', kathrine: 'catherine', cathy: 'catherine',
  annie: 'anne', ann: 'anne', nancy: 'anne', aine: 'anne', anna: 'anne',
  nora: 'honora', norah: 'honora', noreen: 'honora', honor: 'honora', nonie: 'honora',
  ellen: 'helen', ellie: 'helen', nellie: 'helen', eibhlin: 'helen', eileen: 'helen', eveline: 'helen',
  liz: 'elizabeth', lizzie: 'elizabeth', betty: 'elizabeth', bessie: 'elizabeth', eliza: 'elizabeth', eilis: 'elizabeth',
  joe: 'joseph', joey: 'joseph', seosamh: 'joseph', jos: 'joseph',
  willie: 'william', bill: 'william', billy: 'william', liam: 'william', wm: 'william',
  charlie: 'charles', chas: 'charles', cathal: 'charles',
  tom: 'thomas', tommy: 'thomas', tomas: 'thomas', thos: 'thomas',
  frank: 'francis', frankie: 'francis', proinsias: 'francis',
  phil: 'philip', pilib: 'philip',
  tess: 'teresa', tessie: 'teresa', theresa: 'teresa', treasa: 'teresa',
  sally: 'sarah', sadie: 'sarah', sara: 'sarah', sorcha: 'sarah',
  dinny: 'denis', dennis: 'denis', donncha: 'denis',
  manus: 'manus', magnus: 'manus',
  neil: 'neil', neal: 'neil', niall: 'neil',
  eddie: 'edward', ned: 'edward', eamonn: 'edward', eamon: 'edward', edw: 'edward',
  gerry: 'gerard', ger: 'gerard',
  susie: 'susan', susanna: 'susan',
  rosie: 'rose', rosaleen: 'rose', rois: 'rose',
  grace: 'grace', grainne: 'grace',
  agnes: 'agnes', aggie: 'agnes', nessa: 'agnes',
  barney: 'bernard', brian: 'brian',
  tony: 'anthony', antoin: 'anthony',
  peter: 'peter', peadar: 'peter',
  andy: 'andrew', aindrias: 'andrew',
  dominic: 'dominic', dom: 'dominic', dominick: 'dominic',
  owen: 'owen', eoghan: 'owen',
  hannah: 'hannah', hanna: 'hannah', johanna: 'hannah', josie: 'josephine',
};

// Titles, honorifics and suffixes that appear in registers but aren't names.
const FORENAME_NOISE = new Set([
  'mr', 'mrs', 'miss', 'ms', 'dr', 'rev', 'fr', 'father', 'sr', 'sister', 'br', 'brother',
  'jr', 'jnr', 'snr', 'sen', 'senior', 'junior', 'nee', 'the', 'late', 'baby', 'infant', 'child',
]);

export function forenameKeys(forenames: string): string[] {
  const out: string[] = [];
  for (const raw of normalise(forenames).split(' ')) {
    if (!raw || FORENAME_NOISE.has(raw)) continue;
    const canon = FORENAME_CANON[raw] ?? raw;
    if (!out.includes(canon)) out.push(canon);
  }
  return out;
}

/**
 * Split a full name as typed on a memorial ("Mary Ellen O'Donnell",
 * "Pádraig Mac Giolla Easpaig") into forenames + surname. Multi-word
 * surnames are recognised by their Irish prefix.
 */
export function splitFullName(fullName: string): { forenames: string; surname: string } {
  const words = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { forenames: '', surname: '' };
  if (words.length === 1) return { forenames: '', surname: words[0] };
  // Walk back from the end while the preceding word is a surname prefix.
  let start = words.length - 1;
  while (start > 1) {
    const prev = normalise(words[start - 1]);
    if (SURNAME_PREFIXES.has(prev) || prev === 'giolla' || prev === 'de' || prev === 'van') start -= 1;
    else break;
  }
  return {
    forenames: words.slice(0, start).join(' '),
    surname: words.slice(start).join(' '),
  };
}

/** Pull a 4-digit year from an ISO date or free-text date ("12 Mar 1931"). */
export function yearOf(date: string | number | null | undefined): number | null {
  if (typeof date === 'number') return Number.isFinite(date) ? Math.trunc(date) : null;
  if (!date) return null;
  const m = String(date).match(/(1[5-9]\d\d|20\d\d)/);
  return m ? Number(m[1]) : null;
}

export function toIndexBurial(b: GraveBurialInput): GraveIndexBurial {
  const name = [b.forenames, b.surname].filter(Boolean).join(' ').trim();
  return {
    s: surnameKey(b.surname),
    f: forenameKeys(b.forenames || ''),
    y: typeof b.diedYear === 'number' && Number.isFinite(b.diedYear) ? b.diedYear : null,
    n: name,
  };
}

// ─── Similarity ──────────────────────────────────────────────────────────────

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = true;
      bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

const SURNAME_MIN = 0.9;
const FORENAME_MIN = 0.88;
/** Minimum total score for a burial to be suggested. */
export const SUGGEST_THRESHOLD = 0.6;

export interface MatchQuery {
  surname: string;
  forenames?: string;
  diedYear?: number | null;
}

/**
 * Score one burial against the query, 0..1. Returns 0 when the burial is
 * ruled out (surname too different, or a clearly conflicting death year).
 */
export function scoreBurial(
  q: { s: string; f: string[]; y: number | null },
  b: GraveIndexBurial,
): number {
  if (!q.s || !b.s) return 0;
  const sSim = q.s === b.s ? 1 : jaroWinkler(q.s, b.s);
  if (sSim < SURNAME_MIN) return 0;

  // Death year: registers are often a year out (burial vs death date, or a
  // misread digit), so allow ±1. Anything further apart rules it out.
  let yearScore = 0;
  if (q.y !== null && b.y !== null) {
    const diff = Math.abs(q.y - b.y);
    if (diff === 0) yearScore = 1;
    else if (diff === 1) yearScore = 0.7;
    else return 0;
  }

  // Forenames: best pairwise similarity between any query and register name.
  // A lone initial ("P. Gallagher") counts as a weak match.
  let fScore = 0;
  if (q.f.length && b.f.length) {
    for (const qf of q.f) {
      for (const bf of b.f) {
        let s = 0;
        if (qf === bf) s = 1;
        else if (bf.length === 1 || qf.length === 1) s = qf[0] === bf[0] ? 0.5 : 0;
        else {
          const jw = jaroWinkler(qf, bf);
          s = jw >= FORENAME_MIN ? jw * 0.9 : 0;
        }
        if (s > fScore) fScore = s;
      }
    }
    // Both sides have forenames and none agree: almost certainly a
    // different person with the same surname.
    if (fScore === 0) return 0;
  }

  // Weighted blend. Surname is a precondition so it carries less weight than
  // you'd expect; forename + year are what separate the many Gallaghers.
  const hasF = q.f.length > 0 && b.f.length > 0;
  const hasY = q.y !== null && b.y !== null;
  let score = 0.35 * sSim;
  score += hasF ? 0.4 * fScore : 0.2;
  score += hasY ? 0.25 * yearScore : 0.1;
  return Math.min(1, score);
}

export interface GraveSuggestion {
  entry: GraveIndexEntry;
  /** Index into entry.b of the best-matching burial. */
  burialIndex: number;
  score: number;
}

/** Top `limit` graves for the query, best first. */
export function matchGraves(
  query: MatchQuery,
  entries: GraveIndexEntry[],
  limit = 3,
): GraveSuggestion[] {
  const q = {
    s: surnameKey(query.surname),
    f: forenameKeys(query.forenames || ''),
    y: typeof query.diedYear === 'number' ? query.diedYear : null,
  };
  if (!q.s) return [];
  const out: GraveSuggestion[] = [];
  for (const entry of entries) {
    let best = 0;
    let bestIdx = -1;
    entry.b.forEach((b, i) => {
      const s = scoreBurial(q, b);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0 && best >= SUGGEST_THRESHOLD) {
      out.push({ entry, burialIndex: bestIdx, score: best });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** "Section A · Row C · Plot 12" (whatever parts are present). */
export function graveLabel(g: { section?: string | null; row?: string | null; plotNumber?: string | null }): string {
  const parts: string[] = [];
  if (g.section) parts.push(`Section ${g.section}`);
  if (g.row) parts.push(`Row ${g.row}`);
  if (g.plotNumber) parts.push(`Plot ${g.plotNumber}`);
  return parts.join(' · ');
}
