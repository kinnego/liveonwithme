'use client';
// Homepage search — one input that returns both people (public memorials)
// and cemeteries (Google Places + community-added), each row tagged with
// its kind so the two are easy to tell apart at a glance. The three queries
// fire in parallel; the dropdown renders them under section headers so a
// single ambiguous first name like "Mary" doesn't bury the few matching
// graveyards.
//
// Mobile: on focus the input scrolls to the top of the viewport so the
// dropdown has room above the keyboard. Without this, typing on a phone
// drops results behind the keyboard and the user has to guess-scroll.

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { loadGoogleMaps } from '@/lib/places';
import { customPlaceIdOf, searchCustomCemeteries } from '@/lib/cemeteries';
import type { CustomCemetery } from '@/lib/types';

type PersonHit = {
  kind: 'person';
  id: string;
  fullName: string;
  nickname?: string;
  born?: string;
  died?: string;
  cemeteryName?: string;
};
type GoogleCemeteryHit = {
  kind: 'google-cemetery';
  placeId: string;
  primary: string;
  secondary?: string;
};
type CustomCemeteryHit = {
  kind: 'custom-cemetery';
  id: string;
  name: string;
  address?: string;
};
type CemeteryHit = GoogleCemeteryHit | CustomCemeteryHit;

const MIN_CHARS = 2;
const CEMETERY_MIN_CHARS = 3;
const DEBOUNCE_MS = 250;

function formatYears(born?: string, died?: string): string {
  const b = born?.slice(0, 4);
  const d = died?.slice(0, 4);
  if (b && d) return `${b} — ${d}`;
  if (b) return `Born ${b}`;
  if (d) return `Died ${d}`;
  return '';
}

export default function UnifiedSearch() {
  const [term, setTerm] = useState('');
  const [resultsForTerm, setResultsForTerm] = useState('');
  const [people, setPeople] = useState<PersonHit[]>([]);
  const [googleCemeteries, setGoogleCemeteries] = useState<GoogleCemeteryHit[]>([]);
  const [customCemeteries, setCustomCemeteries] = useState<CustomCemeteryHit[]>([]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'searching' | 'ready' | 'no-key' | 'error'>('idle');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const googleRef = useRef<any>(null);
  const sessionTokenRef = useRef<any>(null);
  const requestSeqRef = useRef(0);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(async (google) => {
        if (cancelled) return;
        await google.maps.importLibrary('places');
        googleRef.current = google;
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
      })
      .catch((err: Error) => {
        // Memorials-only mode is still useful if the Maps key isn't configured.
        console.warn('UnifiedSearch: Places unavailable —', err.message);
        if (err.message.includes('not configured')) setStatus('no-key');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  async function fetchPeople(q: string): Promise<PersonHit[]> {
    if (!db) return [];
    const needle = q.toLowerCase();
    const snap = await getDocs(
      query(
        collection(db, 'memorials'),
        where('status', '==', 'live'),
        where('visibility', '==', 'public'),
        where('fullNameLower', '>=', needle),
        where('fullNameLower', '<=', needle + '\uf8ff'),
        orderBy('fullNameLower'),
        fsLimit(6),
      ),
    );
    return snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        kind: 'person' as const,
        id: d.id,
        fullName: data.fullName || '',
        nickname: data.nickname || undefined,
        born: data.born,
        died: data.died,
        cemeteryName: data.cemetery?.name,
      };
    });
  }

  async function fetchGoogleCemeteries(q: string): Promise<GoogleCemeteryHit[]> {
    const google = googleRef.current;
    if (!google?.maps?.places?.AutocompleteSuggestion) return [];
    const request = {
      input: q,
      includedRegionCodes: ['ie', 'gb'],
      includedPrimaryTypes: ['cemetery', 'church', 'place_of_worship'],
      sessionToken: sessionTokenRef.current,
    };
    const { suggestions } =
      await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
    if (!Array.isArray(suggestions)) return [];
    return suggestions
      .map((s: any): GoogleCemeteryHit | null => {
        const p = s.placePrediction;
        if (!p) return null;
        const primary = p.mainText?.text || p.text?.text || '';
        let secondary = p.secondaryText?.text || '';
        if (!secondary && p.text?.text && p.text.text !== primary) {
          secondary = p.text.text.startsWith(`${primary}, `)
            ? p.text.text.slice(primary.length + 2)
            : p.text.text;
        }
        return { kind: 'google-cemetery', placeId: p.placeId, primary, secondary };
      })
      .filter(Boolean) as GoogleCemeteryHit[];
  }

  async function fetchCustomCemeteries(q: string): Promise<CustomCemeteryHit[]> {
    const rows = await searchCustomCemeteries(q, 4).catch(() => [] as CustomCemetery[]);
    return rows.map((c) => ({
      kind: 'custom-cemetery' as const,
      id: c.id,
      name: c.name,
      address: c.address,
    }));
  }

  async function runSearch(q: string) {
    const seq = ++requestSeqRef.current;
    setStatus('searching');
    setOpen(true);
    try {
      const [peopleData, googleData, customData] = await Promise.all([
        fetchPeople(q).catch(() => [] as PersonHit[]),
        q.length >= CEMETERY_MIN_CHARS
          ? fetchGoogleCemeteries(q).catch(() => [] as GoogleCemeteryHit[])
          : Promise.resolve([] as GoogleCemeteryHit[]),
        q.length >= CEMETERY_MIN_CHARS
          ? fetchCustomCemeteries(q)
          : Promise.resolve([] as CustomCemeteryHit[]),
      ]);
      if (seq !== requestSeqRef.current) return;
      setPeople(peopleData);
      setGoogleCemeteries(googleData);
      setCustomCemeteries(customData);
      setResultsForTerm(q);
      setStatus('ready');
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      console.error('UnifiedSearch error:', err);
      setStatus('error');
    }
  }

  useEffect(() => {
    const q = term.trim();
    if (q.length < MIN_CHARS) {
      requestSeqRef.current++;
      setPeople([]);
      setGoogleCemeteries([]);
      setCustomCemeteries([]);
      setResultsForTerm('');
      setStatus('idle');
      setOpen(false);
      return;
    }
    const t = setTimeout(() => runSearch(q), DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  function goToPerson(p: PersonHit) {
    setOpen(false);
    router.push(`/m/${p.id}`);
  }

  function goToGoogleCemetery(c: GoogleCemeteryHit) {
    setOpen(false);
    const q = c.primary ? `?name=${encodeURIComponent(c.primary)}` : '';
    router.push(`/cemetery/${encodeURIComponent(c.placeId)}${q}`);
  }

  function goToCustomCemetery(c: CustomCemeteryHit) {
    setOpen(false);
    router.push(`/cemetery/${customPlaceIdOf(c.id)}`);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Enter picks the top result, preferring people (the more specific
    // match given someone typically types a full name).
    if (people[0]) return goToPerson(people[0]);
    if (googleCemeteries[0]) return goToGoogleCemetery(googleCemeteries[0]);
    if (customCemeteries[0]) return goToCustomCemetery(customCemeteries[0]);
  }

  function onFocus() {
    if (term.trim().length >= MIN_CHARS) setOpen(true);
    // On narrow viewports the keyboard eats the bottom half of the screen.
    // Pulling the input to the top gives the dropdown room to live above
    // the keyboard. Guard on viewport width so desktop isn't jolted.
    if (typeof window !== 'undefined' && window.innerWidth < 720) {
      // Defer until the keyboard animation has started.
      setTimeout(() => {
        wrapperRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  }

  const trimmed = term.trim();
  const showDropdown =
    open && trimmed.length >= MIN_CHARS && status !== 'idle';
  const hasAnyResults =
    people.length > 0 || googleCemeteries.length > 0 || customCemeteries.length > 0;
  const addHref = `/cemetery/add${trimmed ? `?name=${encodeURIComponent(trimmed)}` : ''}`;

  return (
    <div ref={wrapperRef}>
      <div style={{ position: 'relative' }}>
        <form onSubmit={onSubmit}>
          <input
            ref={inputRef}
            type="search"
            placeholder="Search by name or cemetery…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onFocus={onFocus}
            aria-label="Search for a person or a cemetery"
            autoComplete="off"
            style={{ width: '100%' }}
          />
        </form>

        {showDropdown && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              background: 'white',
              border: '1px solid var(--line)',
              borderRadius: 12,
              boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
              zIndex: 30,
              overflow: 'hidden',
              textAlign: 'left',
              maxHeight: '70vh',
              overflowY: 'auto',
            }}
          >
          {status === 'searching' && (
            <div className="muted" style={{ padding: '14px 16px', fontSize: 14 }}>
              Searching…
            </div>
          )}

          {status === 'ready' && people.length > 0 && (
            <div>
              <div style={sectionHeaderStyle}>People</div>
              {people.map((p) => {
                const years = formatYears(p.born, p.died);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => goToPerson(p)}
                    style={rowStyle}
                  >
                    <div style={rowTopStyle}>
                      <div style={{ fontWeight: 600 }}>
                        {p.fullName}
                        {p.nickname && (
                          <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                            ({p.nickname})
                          </span>
                        )}
                      </div>
                      <span style={{ ...pillStyle, background: '#eef3ee', color: '#2f5b48' }}>
                        Person
                      </span>
                    </div>
                    {years && (
                      <div style={{ fontSize: 13, marginTop: 2 }}>{years}</div>
                    )}
                    {p.cemeteryName && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {p.cemeteryName}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {status === 'ready' && (googleCemeteries.length > 0 || customCemeteries.length > 0) && (
            <div>
              <div style={sectionHeaderStyle}>Cemeteries</div>
              {googleCemeteries.map((c) => (
                <button
                  key={c.placeId}
                  type="button"
                  onClick={() => goToGoogleCemetery(c)}
                  style={rowStyle}
                >
                  <div style={rowTopStyle}>
                    <div style={{ fontWeight: 600 }}>{c.primary}</div>
                    <span style={{ ...pillStyle, background: '#f0e8d8', color: '#8b6f30' }}>
                      Cemetery
                    </span>
                  </div>
                  {c.secondary && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {c.secondary}
                    </div>
                  )}
                </button>
              ))}
              {customCemeteries.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => goToCustomCemetery(c)}
                  style={rowStyle}
                >
                  <div style={rowTopStyle}>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <span style={{ ...pillStyle, background: '#f0e8d8', color: '#8b6f30' }}>
                      Cemetery · community
                    </span>
                  </div>
                  {c.address && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {c.address}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {status === 'ready' && !hasAnyResults && (
            <div className="muted" style={{ padding: '14px 16px', fontSize: 14 }}>
              No public memorials or cemeteries match &ldquo;{resultsForTerm}&rdquo;.
            </div>
          )}

          {status === 'error' && (
            <div className="muted" style={{ padding: '14px 16px', fontSize: 14 }}>
              Search couldn&rsquo;t load. Please try again.
            </div>
          )}

            <a
              href={addHref}
              onClick={() => setOpen(false)}
              style={{
                display: 'block',
                padding: '12px 16px',
                borderTop: '1px solid var(--line)',
                background: '#f7f4ee',
                color: 'var(--sage)',
                fontWeight: 600,
                fontSize: 14,
                textDecoration: 'none',
              }}
            >
              + Add a cemetery not listed above
            </a>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          margin: '14px 0 0',
        }}
      >
        <span aria-hidden="true" style={{ flex: 1, height: 1, background: 'var(--line)' }} />
        <span
          className="muted"
          style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}
        >
          or
        </span>
        <span aria-hidden="true" style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>

      <Link
        href="/cemetery/nearby"
        className="button secondary"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          width: '100%',
          marginTop: 12,
          textDecoration: 'none',
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 22s-8-7.58-8-13a8 8 0 1 1 16 0c0 5.42-8 13-8 13z" />
          <circle cx="12" cy="9" r="3" />
        </svg>
        Find graveyards near me
      </Link>

      {status === 'no-key' && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Cemetery search isn&rsquo;t configured yet.
        </p>
      )}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '12px 16px',
  borderTop: '1px solid var(--line)',
  background: 'white',
  border: 'none',
  borderBottom: 'none',
  textAlign: 'left',
  cursor: 'pointer',
  color: 'inherit',
  font: 'inherit',
};

const rowTopStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
};

const pillStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  padding: '3px 8px',
  borderRadius: 999,
  flexShrink: 0,
};

const sectionHeaderStyle: React.CSSProperties = {
  padding: '10px 16px 4px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  fontWeight: 800,
  color: 'var(--sage)',
  background: '#fbf8f2',
  borderTop: '1px solid var(--line)',
};
