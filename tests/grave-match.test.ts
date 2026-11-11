import { describe, it, expect } from 'vitest';
import {
  graveSearchKeys,
  matchBurialForTerms,
  searchTerms,
  forenameKeys,
  graveLabel,
  jaroWinkler,
  matchGraves,
  splitFullName,
  surnameKey,
  toIndexBurial,
  yearOf,
  type GraveIndexEntry,
} from '@/lib/grave-match';

function entry(id: string, burials: Array<[string, string, number | null]>, adopted = false): GraveIndexEntry {
  return {
    id,
    l: `Plot ${id}`,
    b: burials.map(([forenames, surname, diedYear]) => toIndexBurial({ forenames, surname, diedYear })),
    a: adopted,
    p: adopted ? `plot-${id}` : null,
    g: false,
  };
}

describe('surnameKey', () => {
  it('collapses Mc / Mac / Mag and spacing', () => {
    expect(surnameKey('McGinley')).toBe('ginley');
    expect(surnameKey('Mc Ginley')).toBe('ginley');
    expect(surnameKey('MacGinley')).toBe('ginley');
    expect(surnameKey('Mag Fhionnghaile')).toBe('ginley');
  });

  it("collapses O' / Ó and the Irish forms", () => {
    expect(surnameKey("O'Donnell")).toBe('donnell');
    expect(surnameKey('O Donnell')).toBe('donnell');
    expect(surnameKey('ODonnell')).toBe('donnell');
    expect(surnameKey('Ó Dónaill')).toBe('donnell');
    expect(surnameKey('Ní Dhomhnaill')).toBe('donnell');
    expect(surnameKey('Ó Gallchobhair')).toBe('gallagher');
    expect(surnameKey('Mac Giolla Easpaig')).toBe('gillespie');
  });

  it('collapses common spelling variants', () => {
    expect(surnameKey('Gallacher')).toBe('gallagher');
    expect(surnameKey('Docherty')).toBe('doherty');
  });

  it("doesn't mangle ordinary surnames", () => {
    expect(surnameKey('Owens')).toBe('owens');
    expect(surnameKey('Macken')).toBe('macken');
    expect(surnameKey('Boyle')).toBe('boyle');
  });

  it("keeps O'Connell and O'Donnell apart", () => {
    expect(surnameKey("O'Connell")).not.toBe(surnameKey("O'Donnell"));
  });
});

describe('forenameKeys', () => {
  it('maps nicknames and Irish forms to one canonical name', () => {
    expect(forenameKeys('Paddy')).toEqual(['patrick']);
    expect(forenameKeys('Pádraig')).toEqual(['patrick']);
    expect(forenameKeys('Biddy')).toEqual(['bridget']);
    expect(forenameKeys('Máire Ellen')).toEqual(['mary', 'helen']);
  });

  it('drops titles and noise words', () => {
    expect(forenameKeys('Mrs. Bridget')).toEqual(['bridget']);
    expect(forenameKeys('Rev. Fr. James')).toEqual(['james']);
  });
});

describe('splitFullName', () => {
  it('splits simple names', () => {
    expect(splitFullName('Mary Ellen Gallagher')).toEqual({ forenames: 'Mary Ellen', surname: 'Gallagher' });
  });

  it('keeps Irish multi-word surnames together', () => {
    expect(splitFullName('Pádraig Mac Giolla Easpaig')).toEqual({
      forenames: 'Pádraig',
      surname: 'Mac Giolla Easpaig',
    });
    expect(splitFullName('Máire Ní Dhomhnaill')).toEqual({ forenames: 'Máire', surname: 'Ní Dhomhnaill' });
    expect(splitFullName("Mary O'Donnell")).toEqual({ forenames: 'Mary', surname: "O'Donnell" });
  });

  it('handles a single word', () => {
    expect(splitFullName('Gallagher')).toEqual({ forenames: '', surname: 'Gallagher' });
  });
});

describe('yearOf', () => {
  it('reads ISO and free-text dates', () => {
    expect(yearOf('1987-03-02')).toBe(1987);
    expect(yearOf('12th March 1931')).toBe(1931);
    expect(yearOf('')).toBeNull();
    expect(yearOf(undefined)).toBeNull();
    expect(yearOf('unknown')).toBeNull();
  });
});

describe('jaroWinkler', () => {
  it('is 1 for identical strings and high for small typos', () => {
    expect(jaroWinkler('gallagher', 'gallagher')).toBe(1);
    expect(jaroWinkler('gallagher', 'galagher')).toBeGreaterThan(0.9);
    expect(jaroWinkler('boyle', 'doherty')).toBeLessThan(0.6);
  });
});

describe('matchGraves', () => {
  const register: GraveIndexEntry[] = [
    entry('1', [['Mary', "O'Donnell", 1987], ['Hugh', "O'Donnell", 1979]]),
    entry('2', [['Patrick', 'Gallagher', 1952]]),
    entry('3', [['Patrick', 'Gallagher', 2001]]),
    entry('4', [['Bridget', 'Gallagher', 1952]]),
    entry('5', [['James', 'Boyle', 1960]]),
    entry('6', [['', 'McGinley', null]]),
  ];

  it('finds the right grave from an Irish-language memorial name', () => {
    const res = matchGraves({ forenames: 'Máire', surname: 'Ní Dhomhnaill', diedYear: 1987 }, register);
    expect(res[0]?.entry.id).toBe('1');
    expect(res[0]?.burialIndex).toBe(0);
  });

  it('uses the death year to pick between two Patrick Gallaghers', () => {
    const res = matchGraves({ forenames: 'Paddy', surname: 'Gallacher', diedYear: 2001 }, register);
    expect(res.map((r) => r.entry.id)).toEqual(['3']);
  });

  it('allows the register to be a year out', () => {
    const res = matchGraves({ forenames: 'Patrick', surname: 'Gallagher', diedYear: 1953 }, register);
    expect(res[0]?.entry.id).toBe('2');
  });

  it('rules out a different forename with the same surname', () => {
    const res = matchGraves({ forenames: 'Bridget', surname: 'Gallagher', diedYear: 1952 }, register);
    expect(res.map((r) => r.entry.id)).toEqual(['4']);
  });

  it('still suggests when the register has no forename or year', () => {
    const res = matchGraves({ forenames: 'Anne', surname: 'Mac Ginley', diedYear: 1990 }, register);
    expect(res.map((r) => r.entry.id)).toEqual(['6']);
  });

  it('returns nothing for an unrelated surname', () => {
    expect(matchGraves({ forenames: 'Mary', surname: 'Sweeney', diedYear: 1987 }, register)).toEqual([]);
  });

  it('caps the number of suggestions', () => {
    const many = Array.from({ length: 10 }, (_, i) => entry(String(i), [['', 'Gallagher', null]]));
    expect(matchGraves({ surname: 'Gallagher' }, many)).toHaveLength(3);
  });
});

describe('graveLabel', () => {
  it('joins the parts that are present', () => {
    expect(graveLabel({ section: 'A', row: 'C', plotNumber: '12' })).toBe('Section A · Row C · Plot 12');
    expect(graveLabel({ row: '4' })).toBe('Row 4');
    expect(graveLabel({})).toBe('');
  });
});

describe('public register search', () => {
  const grave = [
    { surname: "O'Donnell", forenames: 'Bridget', nickname: 'Biddy' },
    { surname: 'Mc Ginley', forenames: 'Patrick' },
  ];
  const find = (q: string) => matchBurialForTerms(grave, searchTerms(q));

  it('finds a person by full or partial name', () => {
    expect(find("Bridget O'Donnell")).toBe(0);
    expect(find('odonnell')).toBe(0);
    expect(find('O Donn')).toBe(0);
    expect(find('Donnell')).toBe(0);
    expect(find('brid')).toBe(0);
  });

  it('understands nicknames, Irish forms and Mc/Mac', () => {
    expect(find('Biddy')).toBe(0);
    expect(find('Bríd Ó Dónaill')).toBe(0);
    expect(find('Paddy McGinley')).toBe(1);
    expect(find('Pádraig Mac Ginley')).toBe(1);
  });

  it('needs every word to match the same person', () => {
    expect(find('Patrick Donnell')).toBe(-1);
    expect(find('Mary')).toBe(-1);
    expect(find('O')).toBe(-1);
  });

  it('stores keys the search can query', () => {
    const keys = new Set(graveSearchKeys(grave));
    for (const t of searchTerms('Bridget Ginley')) expect(t.some((v) => keys.has(v))).toBe(true);
  });
});
