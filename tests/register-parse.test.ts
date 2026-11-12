import { describe, it, expect } from 'vitest';
import {
  buildAiPrompt,
  graveKeyOf,
  mapHeaders,
  parseRegister,
  parseTable,
  plotKey,
  templateCsv,
} from '@/lib/register-parse';

describe('parseTable', () => {
  it('reads CSV with quoted commas and newlines', () => {
    const rows = parseTable('Surname,Inscription\nBoyle,"In loving memory, Ardara"\nGallagher,"Line one\nline two"\n');
    expect(rows).toEqual([
      ['Surname', 'Inscription'],
      ['Boyle', 'In loving memory, Ardara'],
      ['Gallagher', 'Line one\nline two'],
    ]);
  });

  it('reads a table pasted from Excel (tab-separated)', () => {
    expect(parseTable('Surname\tForenames\nBoyle\tJames\n')).toEqual([
      ['Surname', 'Forenames'],
      ['Boyle', 'James'],
    ]);
  });

  it('reads a Markdown table pasted from ChatGPT', () => {
    const md = '| Surname | Died |\n|---|:---:|\n| Boyle | 1952 |\n| Gallagher | 1960 |';
    expect(parseTable(md)).toEqual([
      ['Surname', 'Died'],
      ['Boyle', '1952'],
      ['Gallagher', '1960'],
    ]);
  });

  it('reads semicolon CSV from European Excel', () => {
    expect(parseTable('Surname;Died\nBoyle;1952')).toEqual([
      ['Surname', 'Died'],
      ['Boyle', '1952'],
    ]);
  });
});

describe('mapHeaders', () => {
  it('matches loose header names', () => {
    const { columns, unknown } = mapHeaders(['Grave No.', 'SURNAME', 'Christian Name', 'Date of Death', 'Townland', 'Wife of', 'Mystery']);
    expect(columns).toMatchObject({ plotNumber: 0, surname: 1, forenames: 2, died: 3, address: 4, relations: 5 });
    expect(unknown).toEqual(['Mystery']);
  });

  it('treats a lone Name column as the full name', () => {
    const { columns } = mapHeaders(['Name', 'Died']);
    expect(columns.surname).toBe(0);
    expect(columns.forenames).toBeUndefined();
  });
});

describe('parseRegister', () => {
  it('groups people sharing a plot into one grave', () => {
    const res = parseRegister(
      [
        'Section,Row,Plot,Surname,Forenames,Died,Known as,Relations',
        "A,1,1,O'Donnell,Hugh,14 Feb 1979,Hughie,",
        "A,1,1,O'Donnell,Mary,2 Mar 1987,,wife of Hugh",
        'A,1,2,Gallagher,Patrick,1952,,',
      ].join('\n'),
    );
    expect(res.error).toBeUndefined();
    expect(res.people).toBe(3);
    expect(res.graves).toHaveLength(2);
    expect(res.graves[0].burials.map((b) => b.forenames)).toEqual(['Hugh', 'Mary']);
    expect(res.graves[0].burials[0].nickname).toBe('Hughie');
    expect(res.graves[0].burials[1].relations).toBe('wife of Hugh');
    expect(res.graves[0].burials[1].diedYear).toBe(1987);
  });

  it('keeps people without a plot number as separate graves', () => {
    const res = parseRegister('Surname,Forenames,Died\nBoyle,James,1950\nBoyle,Anne,1951');
    expect(res.graves).toHaveLength(2);
  });

  it('splits a full-name column, keeping Irish surname prefixes', () => {
    const res = parseRegister('Name,Died\nMary Ellen Gallagher,1950\nPádraig Ó Dónaill,1960');
    expect(res.graves[0].burials[0]).toMatchObject({ forenames: 'Mary Ellen', surname: 'Gallagher' });
    expect(res.graves[1].burials[0]).toMatchObject({ forenames: 'Pádraig', surname: 'Ó Dónaill' });
  });

  it('counts unclear words and skipped rows', () => {
    const res = parseRegister('Surname,Forenames,Died\nBoyle,Bridget??,1923??\n,Unknown,1900');
    expect(res.uncertainCells).toBe(2);
    expect(res.skippedRows).toEqual([3]);
  });

  it('uses the burial year when there is no death date', () => {
    const res = parseRegister('Surname,Buried\nBoyle,3 Jan 1931');
    expect(res.graves[0].burials[0].diedYear).toBe(1931);
  });

  it('explains a missing surname column', () => {
    expect(parseRegister('Who,When\nBoyle,1950').error).toMatch(/Surname/);
  });

  it('gives stable keys for re-uploads', () => {
    const a = parseRegister('Section,Row,Plot,Surname\nA,1,7,Boyle').graves[0];
    expect(a.key).toBe(plotKey('a', '1', '7'));
    expect(graveKeyOf({ section: 'A', row: '1', plotNumber: '7', burials: [{ surname: 'X' }] })).toBe(a.key);
    const b = parseRegister('Surname,Forenames,Died\nBoyle,James,1950').graves[0];
    expect(graveKeyOf({ burials: [{ surname: 'Boyle', forenames: 'James', diedYear: 1950 }] })).toBe(b.key);
  });
});

describe('templates and prompt', () => {
  it('always includes the required columns', () => {
    expect(templateCsv([])).toBe('Surname,Forenames,Died\n');
    expect(templateCsv(['section', 'row', 'plotNumber', 'nickname'])).toBe('Section,Row,Plot,Surname,Forenames,Known as,Died\n');
  });

  it('builds a prompt naming the chosen columns', () => {
    const p = buildAiPrompt({ selected: ['relations', 'age'], format: 'handwritten', cemeteryName: 'St Mary’s' });
    expect(p).toContain('handwritten burial register for St Mary’s');
    expect(p).toContain('Surname, Forenames, Died, Age, Relations');
    expect(p).toContain('Relations, not in the name columns');
    expect(p).toContain('??');
  });
});

describe('accepting AI-typed lists as they come', () => {
  const sample = [
    'Section,Plot,Surname,Forenames,Died,Age,Address,Notes',
    'A,466,Bannon,Miss,March 1873,6,,',
    'A,466,Bannon,Roseanne,November 187? ,32,,Year unclear in image',
    'A,124,Bonar,Mickey,June 2005,84,,',
    'A,124,Boner,Thomas J,February 1914,,,',
    'A,374,Bennett,FR Sean,July 2010,84,Tiernaleague,',
    'A,347,Bradley,Family,,,,Family entry',
    'A,17,Bradley,Bridget,,,Tulnaree,Year/month not visible',
    'A,449,Bradley,Bridie,,30,,',
    'A,449,Brady,Sarah,1945,,,',
  ].join('\n');
  const res = parseRegister(sample);

  it('keeps every real person and leaves out placeholder rows', () => {
    expect(res.error).toBeUndefined();
    expect(res.people).toBe(8);
    expect(res.notPersonRows).toEqual([7]);
    expect(res.checks.find((c) => c.kind === 'notPerson')).toMatchObject({ row: 7, detail: 'Family' });
  });

  it('flags a single ? and words like "unclear" or "not visible"', () => {
    const unclear = res.checks.filter((c) => c.kind === 'unclear');
    expect(unclear.map((c) => c.row)).toEqual([3, 8]);
    expect(unclear[0].detail).toContain('November 187?');
    expect(res.uncertainCells).toBe(3);
  });

  it('flags a first-name cell that is only a title, but not a title with a name', () => {
    const titles = res.checks.filter((c) => c.kind === 'titleOnly');
    expect(titles).toEqual([{ row: 2, kind: 'titleOnly', name: 'Miss Bannon', detail: 'Miss' }]);
  });

  it('notes near-identical surnames in one plot, not short different ones', () => {
    const similar = res.checks.filter((c) => c.kind === 'similarSurname');
    expect(similar).toHaveLength(1);
    expect(similar[0]).toMatchObject({ row: 5, name: 'Thomas J Boner', detail: 'Bonar', plot: 'Section A, Plot 124' });
  });

  it('lists checks in sheet order', () => {
    const rows = res.checks.map((c) => c.row);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  it('tells the registrar what to ask ChatGPT when there are no surnames', () => {
    expect(parseRegister('Who,When\nBoyle,1950').error).toMatch(/ask(ing)? ChatGPT/);
  });
});

describe('big sheets from spreadsheets', () => {
  it('reads plot 135.0 as 135', () => {
    const r = parseRegister('Section,Plot,Surname,Forenames\nA,135.0,Anderson,Catherine\nA,135,Anderson,John');
    expect(r.graves).toHaveLength(1);
    expect(r.graves[0].plotNumber).toBe('135');
  });

  it('adds a line typed twice only once, and says so', () => {
    const r = parseRegister('Section,Plot,Surname,Forenames,Died\nA,1,Bradley,Rose,1891\nA,1,Bradley,Rose,1891\n,,Doherty,Ann,1950\n,,Doherty,Ann,1950');
    expect(r.people).toBe(2);
    expect(r.duplicateRows).toEqual([3, 5]);
    expect(r.checks.filter((c) => c.kind === 'duplicate').map((c) => c.detail)).toEqual(['2', '4']);
  });

  it('keeps two different people with the same name and no plot as separate graves', () => {
    const r = parseRegister('Surname,Forenames,Address\nBradley,John,Pound St\nBradley,John,Tulnaree\nBradley,John,Malin');
    const keys = r.graves.map((g) => g.key);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).not.toContain('#');
    expect(keys[1]).toMatch(/#2$/);
  });
});
