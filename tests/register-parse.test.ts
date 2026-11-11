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
