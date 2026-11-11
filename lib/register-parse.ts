// Turns a burial register spreadsheet into graves.
//
// Accepts what registrars will actually have: a CSV saved from Excel, a
// table copied out of Excel or Google Sheets (tab-separated), or a table
// copied out of ChatGPT / Claude (tab-separated or Markdown pipes).
// Column headers are matched loosely, so "Date of death", "DOD" and "Died"
// all land in the same field.
//
// Pure and dependency-free: used by the upload API, the registrar page's
// preview and the command-line import script (run with Node's type
// stripping, so keep to erasable TypeScript and no imports).

export type RegisterField =
  | 'section'
  | 'row'
  | 'plotNumber'
  | 'surname'
  | 'forenames'
  | 'nickname'
  | 'born'
  | 'died'
  | 'buried'
  | 'age'
  | 'address'
  | 'relations'
  | 'inscription'
  | 'notes'
  | 'lat'
  | 'lng';

export interface RegisterFieldInfo {
  key: RegisterField;
  /** Column header used in templates and AI prompts. */
  header: string;
  /** Plain-English question for the "what's in your register" form. */
  question: string;
  aliases: string[];
  /** Always included in templates. */
  required?: boolean;
  /** Offered in the setup questions (lat/lng aren't: pins come later). */
  askable?: boolean;
}

export const REGISTER_FIELDS: RegisterFieldInfo[] = [
  { key: 'section', header: 'Section', question: 'Section or area of the graveyard', aliases: ['section', 'sect', 'area', 'part'], askable: true },
  { key: 'row', header: 'Row', question: 'Row', aliases: ['row', 'line'], askable: true },
  { key: 'plotNumber', header: 'Plot', question: 'Grave or plot number', aliases: ['plot', 'plotnumber', 'plotno', 'grave', 'graveno', 'gravenumber', 'number', 'no', 'lair'], askable: true },
  { key: 'surname', header: 'Surname', question: 'Surname', aliases: ['surname', 'lastname', 'familyname', 'sloinne'], required: true, askable: true },
  { key: 'forenames', header: 'Forenames', question: 'First names', aliases: ['forenames', 'forename', 'firstname', 'firstnames', 'christianname', 'christiannames', 'givenname', 'givennames', 'name'], required: true, askable: true },
  { key: 'nickname', header: 'Known as', question: 'Nicknames or the name they were known by', aliases: ['nickname', 'nicknames', 'knownas', 'alias', 'pettname', 'familiarname'], askable: true },
  { key: 'born', header: 'Born', question: 'Date of birth', aliases: ['born', 'dob', 'dateofbirth', 'birth', 'birthdate', 'yearofbirth'], askable: true },
  { key: 'died', header: 'Died', question: 'Date of death', aliases: ['died', 'dateofdeath', 'death', 'dod', 'deathdate', 'yearofdeath', 'year'], required: true, askable: true },
  { key: 'buried', header: 'Buried', question: 'Date of burial', aliases: ['buried', 'burial', 'dateofburial', 'burialdate', 'interred', 'dateofinterment'], askable: true },
  { key: 'age', header: 'Age', question: 'Age at death', aliases: ['age', 'aged', 'ageatdeath'], askable: true },
  { key: 'address', header: 'Address', question: 'Address or townland', aliases: ['address', 'townland', 'residence', 'abode', 'lastaddress', 'placeofresidence', 'from'], askable: true },
  { key: 'relations', header: 'Relations', question: 'Family relations (e.g. "wife of John", "son of Mary")', aliases: ['relations', 'relation', 'relationship', 'relatives', 'family', 'spouse', 'parents', 'wifeof', 'sonof', 'daughterof'], askable: true },
  { key: 'inscription', header: 'Inscription', question: 'Headstone inscription', aliases: ['inscription', 'headstone', 'epitaph', 'headstoneinscription'], askable: true },
  { key: 'notes', header: 'Notes', question: 'Other notes or remarks', aliases: ['notes', 'note', 'remarks', 'comments', 'other', 'officiant', 'priest'], askable: true },
  { key: 'lat', header: 'Latitude', question: 'Latitude', aliases: ['lat', 'latitude'] },
  { key: 'lng', header: 'Longitude', question: 'Longitude', aliases: ['lng', 'lon', 'long', 'longitude'] },
];

/** Marker the AI prompt asks for when a word can't be read. */
export const UNCERTAIN_MARK = '??';

// ─── Table parsing ───────────────────────────────────────────────────────────

function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"' && field === '') inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseMarkdown(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    // Skip the |---|:---:| separator row.
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue;
    rows.push(cells);
  }
  return rows;
}

/** Parse CSV, tab-separated or Markdown-table text into rows of cells. */
export function parseTable(text: string): string[][] {
  const clean = (text || '').replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/).find((l) => l.trim()) || '';
  let rows: string[][];
  if (firstLine.trim().startsWith('|')) rows = parseMarkdown(clean);
  else if (firstLine.includes('\t')) rows = parseDelimited(clean, '\t');
  else if (firstLine.split(';').length > firstLine.split(',').length) rows = parseDelimited(clean, ';');
  else rows = parseDelimited(clean, ',');
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''));
}

function headerKey(h: string): string {
  return h.toLowerCase().replace(/[^a-z]/g, '');
}

export interface HeaderMap {
  columns: Partial<Record<RegisterField, number>>;
  unknown: string[];
}

export function mapHeaders(headerRow: string[]): HeaderMap {
  const columns: Partial<Record<RegisterField, number>> = {};
  const unknown: string[] = [];
  headerRow.forEach((h, i) => {
    const key = headerKey(h);
    if (!key) return;
    const field = REGISTER_FIELDS.find((f) => f.aliases.includes(key));
    if (field && columns[field.key] === undefined) columns[field.key] = i;
    else unknown.push(h);
  });
  // A single "Name" column with no separate surname: treat it as a full
  // name and split it later.
  if (columns.surname === undefined && columns.forenames !== undefined && headerKey(headerRow[columns.forenames]) === 'name') {
    columns.surname = columns.forenames;
    delete columns.forenames;
  }
  return { columns, unknown };
}

// ─── Grouping into graves ────────────────────────────────────────────────────

export interface ParsedBurial {
  surname: string;
  forenames?: string;
  nickname?: string;
  born?: string;
  died?: string;
  diedYear: number | null;
  buried?: string;
  age?: string;
  address?: string;
  relations?: string;
  notes?: string;
}

export interface ParsedGrave {
  /** Identity used to find the same grave again on a later upload. */
  key: string;
  section: string;
  row: string;
  plotNumber: string;
  inscription: string;
  lat: number | null;
  lng: number | null;
  burials: ParsedBurial[];
}

export interface ParsedRegister {
  graves: ParsedGrave[];
  people: number;
  /** Data rows with no surname (skipped). */
  skippedRows: number[];
  /** Number of cells the AI marked as unclear with "??". */
  uncertainCells: number;
  columns: RegisterField[];
  unknownHeaders: string[];
  error?: string;
}

/** Year from an ISO or free-text date ("12 Mar 1931", "1931"). */
export function registerYear(date: string | undefined | null): number | null {
  if (!date) return null;
  const m = String(date).match(/(1[5-9]\d\d|20\d\d)/);
  return m ? Number(m[1]) : null;
}

function simple(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

/** Identity of a grave with a plot number: section + row + plot. */
export function plotKey(section: string, row: string, plotNumber: string): string {
  return `plot:${simple(section)}|${simple(row)}|${simple(plotNumber)}`;
}

/** Identity of a grave with no plot number: the first person's name + year. */
export function personKey(b: { surname: string; forenames?: string; diedYear?: number | null }): string {
  return `person:${simple(b.forenames || '')}|${simple(b.surname)}|${b.diedYear ?? ''}`;
}

export function graveKeyOf(g: { section?: string; row?: string; plotNumber?: string; burials: { surname: string; forenames?: string; diedYear?: number | null }[] }): string {
  if (g.plotNumber) return plotKey(g.section || '', g.row || '', g.plotNumber);
  return g.burials[0] ? personKey(g.burials[0]) : '';
}

export const MAX_UPLOAD_ROWS = 5000;

export function parseRegister(text: string): ParsedRegister {
  const empty: ParsedRegister = { graves: [], people: 0, skippedRows: [], uncertainCells: 0, columns: [], unknownHeaders: [] };
  const rows = parseTable(text);
  if (rows.length < 2) return { ...empty, error: 'There’s nothing to import. Include the header row and at least one person.' };
  const { columns, unknown } = mapHeaders(rows[0]);
  if (columns.surname === undefined) {
    return {
      ...empty,
      unknownHeaders: unknown,
      error: `We couldn’t find a Surname column. The first row should be the column headings; we found: ${rows[0].join(', ')}`,
    };
  }
  if (rows.length - 1 > MAX_UPLOAD_ROWS) {
    return { ...empty, error: `That’s more than ${MAX_UPLOAD_ROWS} people. Please split it into smaller sheets.` };
  }
  const get = (r: string[], f: RegisterField) => {
    const i = columns[f];
    return i === undefined ? '' : (r[i] ?? '').trim();
  };

  const graves = new Map<string, ParsedGrave>();
  const skippedRows: number[] = [];
  let uncertainCells = 0;
  let people = 0;

  rows.slice(1).forEach((r, i) => {
    for (const c of r) if (c.includes(UNCERTAIN_MARK)) uncertainCells++;
    let surname = get(r, 'surname');
    let forenames = get(r, 'forenames');
    // Full name in one column: last word is the surname.
    if (surname && columns.forenames === undefined && /\s/.test(surname)) {
      const words = surname.split(/\s+/);
      const cut = words.length >= 3 && /^(mac|mc|o|ó|ni|ní|nic|ui|uí|de|van)$/i.test(words[words.length - 2].replace(/['’]/g, '')) ? 2 : 1;
      forenames = words.slice(0, -cut).join(' ');
      surname = words.slice(-cut).join(' ');
    }
    if (!surname) {
      skippedRows.push(i + 2);
      return;
    }
    const died = get(r, 'died');
    const burial: ParsedBurial = { surname, diedYear: registerYear(died) ?? registerYear(get(r, 'buried')) };
    if (forenames) burial.forenames = forenames;
    for (const f of ['nickname', 'born', 'buried', 'age', 'address', 'relations', 'notes'] as const) {
      const v = get(r, f);
      if (v) burial[f] = v;
    }
    if (died) burial.died = died;

    const section = get(r, 'section');
    const row = get(r, 'row');
    const plotNumber = get(r, 'plotNumber');
    const key = plotNumber ? plotKey(section, row, plotNumber) : `${personKey(burial)}#${i}`;
    let g = graves.get(key);
    if (!g) {
      g = { key: plotNumber ? key : personKey(burial), section, row, plotNumber, inscription: '', lat: null, lng: null, burials: [] };
      graves.set(key, g);
    }
    g.burials.push(burial);
    people++;
    const inscription = get(r, 'inscription');
    if (inscription && !g.inscription) g.inscription = inscription;
    const lat = Number(get(r, 'lat'));
    const lng = Number(get(r, 'lng'));
    if (get(r, 'lat') && get(r, 'lng') && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      g.lat = lat;
      g.lng = lng;
    }
  });

  return {
    graves: [...graves.values()],
    people,
    skippedRows,
    uncertainCells,
    columns: Object.keys(columns) as RegisterField[],
    unknownHeaders: unknown,
  };
}

// ─── Templates and the AI prompt ─────────────────────────────────────────────

export function fieldsForTemplate(selected: RegisterField[]): RegisterFieldInfo[] {
  return REGISTER_FIELDS.filter((f) => f.askable && (f.required || selected.includes(f.key)));
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A CSV with just the header row, for Excel or Google Sheets. */
export function templateCsv(selected: RegisterField[]): string {
  return fieldsForTemplate(selected).map((f) => csvCell(f.header)).join(',') + '\n';
}

export type RegisterFormat = 'handwritten' | 'typed' | 'spreadsheet' | 'cards' | 'other';

export function buildAiPrompt(opts: { selected: RegisterField[]; format: RegisterFormat; cemeteryName?: string }): string {
  const fields = fieldsForTemplate(opts.selected);
  const source =
    opts.format === 'handwritten'
      ? 'photos of pages from a handwritten burial register'
      : opts.format === 'cards'
        ? 'photos of handwritten burial record cards'
        : opts.format === 'typed'
          ? 'photos or scans of a typed burial register'
          : 'a burial register';
  const where = opts.cemeteryName ? ` for ${opts.cemeteryName}` : '';
  const lines = [
    `These are ${source}${where}. Please transcribe every burial into one table.`,
    '',
    `Use exactly these columns, in this order: ${fields.map((f) => f.header).join(', ')}.`,
    '',
    'Rules:',
    '- One row per person buried. If several people share a grave, give each their own row with the same Section, Row and Plot.',
    '- Copy names, places and dates exactly as written. Do not correct, translate or modernise spellings (keep Irish spellings and old abbreviations like "Jas." or "Margt.").',
    '- Leave a cell empty if the register doesn’t give that detail. Never guess or invent information.',
    `- If a word or number is hard to read, write your best guess followed by ${UNCERTAIN_MARK} (for example "Bridget${UNCERTAIN_MARK}" or "1923${UNCERTAIN_MARK}").`,
  ];
  if (fields.some((f) => f.key === 'relations')) {
    lines.push('- Put family relationships ("wife of John Boyle", "infant son of Patrick") in Relations, not in the name columns.');
  }
  if (fields.some((f) => f.key === 'nickname')) {
    lines.push('- Put nicknames or "known as" names in Known as, not in Forenames.');
  }
  lines.push(
    '- Put anything else written about the person in Notes.',
    '- Don’t skip entries, even crossed-out or partial ones; note "crossed out" in Notes.',
    '',
    'Give me the table as plain CSV text in a code block, with the column headings as the first line, so I can copy it straight into a spreadsheet. If there are many pages, do them all, then tell me how many people you transcribed from each page.',
  );
  return lines.join('\n');
}
