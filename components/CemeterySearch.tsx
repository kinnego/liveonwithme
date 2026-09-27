'use client';
// Unified cemetery search — Google Places suggestions and community-added
// cemeteries appear together in one dropdown so families never have to guess
// which "side" to search. Small church graveyards and older burial grounds
// often aren't on Google, so we always offer an "Add a cemetery" fallback.
//
// Live autocomplete kicks in after MIN_CHARS characters, debounced by
// DEBOUNCE_MS. Google Places autocomplete is metered — starting at 3 chars
// avoids firing a request for every single-letter typed. Enter still
// triggers an immediate search (skipping the debounce).

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { loadGoogleMaps } from '@/lib/places';
import { customPlaceIdOf, searchCustomCemeteries } from '@/lib/cemeteries';
import type { CustomCemetery } from '@/lib/types';

type GoogleSuggestion = {
  placeId: string;
  primary: string;
  secondary?: string;
};

const MIN_CHARS = 3;
const DEBOUNCE_MS = 250;

export default function CemeterySearch() {
  const [term, setTerm] = useState('');
  const [resultsForTerm, setResultsForTerm] = useState('');
  const [googleResults, setGoogleResults] = useState<GoogleSuggestion[]>([]);
  const [customResults, setCustomResults] = useState<CustomCemetery[]>([]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'searching' | 'ready' | 'no-key' | 'error'>('idle');
  const wrapperRef = useRef<HTMLDivElement>(null);
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
        console.error('CemeterySearch load error:', err);
        if (err.message.includes('not configured')) setStatus('no-key');
        else setStatus('error');
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

  async function fetchGoogleSuggestions(q: string): Promise<GoogleSuggestion[]> {
    const google = googleRef.current;
    if (!google?.maps?.places?.AutocompleteSuggestion) return [];
    // Google's primary-type tag for cemeteries is narrow — many church
    // graveyards and historic burial grounds are tagged `church` or
    // `place_of_worship` instead, so we broaden the filter.
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
      .map((s: any): GoogleSuggestion | null => {
        const p = s.placePrediction;
        if (!p) return null;
        const primary = p.mainText?.text || p.text?.text || '';
        let secondary = p.secondaryText?.text || '';
        // Free fallback: many rural churches come back with secondaryText
        // undefined, but text.text is the full display string ("St Mary's
        // Church, Ballycasey, Co. Clare, Ireland"). Strip the primary prefix
        // and use the tail — costs nothing extra beyond the autocomplete call.
        if (!secondary && p.text?.text && p.text.text !== primary) {
          secondary = p.text.text.startsWith(`${primary}, `)
            ? p.text.text.slice(primary.length + 2)
            : p.text.text;
        }
        return { placeId: p.placeId, primary, secondary };
      })
      .filter(Boolean) as GoogleSuggestion[];
  }

  async function runSearch(q: string) {
    // Ignore results from a request that's been superseded by newer typing.
    // Without this a slow older request can overwrite a fresh one.
    const seq = ++requestSeqRef.current;
    setStatus('searching');
    setOpen(true);
    try {
      const [googleData, customData] = await Promise.all([
        fetchGoogleSuggestions(q),
        searchCustomCemeteries(q, 5).catch(() => [] as CustomCemetery[]),
      ]);
      if (seq !== requestSeqRef.current) return;
      setGoogleResults(googleData);
      setCustomResults(customData);
      setResultsForTerm(q);
      setStatus('ready');
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      console.error('CemeterySearch query error:', err);
      setStatus('error');
    }
  }

  useEffect(() => {
    const q = term.trim();
    if (q.length < MIN_CHARS) {
      requestSeqRef.current++;
      setGoogleResults([]);
      setCustomResults([]);
      setResultsForTerm('');
      setStatus('idle');
      setOpen(false);
      return;
    }
    const t = setTimeout(() => runSearch(q), DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    // With live autocomplete, Enter's job is to pick the top suggestion so
    // keyboard users don't have to tab into the list. Prefer Google
    // suggestions over community-added ones (Google's ranking is usually
    // better for well-known places).
    e.preventDefault();
    if (googleResults[0]) return goToGooglePlace(googleResults[0]);
    if (customResults[0]) return goToCustom(customResults[0]);
  }

  function goToGooglePlace(s: GoogleSuggestion) {
    setOpen(false);
    const q = s.primary ? `?name=${encodeURIComponent(s.primary)}` : '';
    router.push(`/cemetery/${encodeURIComponent(s.placeId)}${q}`);
  }

  function goToCustom(c: CustomCemetery) {
    setOpen(false);
    router.push(`/cemetery/${customPlaceIdOf(c.id)}`);
  }

  // Dropdown is visible whenever there's enough typed to have triggered a
  // search. The "searching" state shows a spinner-ish line so users get
  // feedback while the debounced request is in flight.
  const showDropdown =
    open && term.trim().length >= MIN_CHARS && status !== 'idle' && status !== 'no-key';
  const hasAnyResults = googleResults.length > 0 || customResults.length > 0;
  const addHref = `/cemetery/add${term.trim() ? `?name=${encodeURIComponent(term.trim())}` : ''}`;

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <form onSubmit={onSubmit}>
        <input
          type="search"
          placeholder="Search a cemetery in Ireland or the UK…"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
          }}
          onFocus={() => {
            if (term.trim().length >= MIN_CHARS) setOpen(true);
          }}
          aria-label="Cemetery search"
          autoComplete="off"
          style={{ width: '100%' }}
        />
      </form>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          margin: '14px 0 0',
        }}
      >
        <span
          aria-hidden="true"
          style={{ flex: 1, height: 1, background: 'var(--line)' }}
        />
        <span
          className="muted"
          style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em' }}
        >
          or
        </span>
        <span
          aria-hidden="true"
          style={{ flex: 1, height: 1, background: 'var(--line)' }}
        />
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
          Search isn&rsquo;t configured yet.
        </p>
      )}

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
          }}
        >
          {status === 'searching' && (
            <div className="muted" style={{ padding: '14px 16px', fontSize: 14 }}>
              Searching…
            </div>
          )}

          {status === 'ready' && googleResults.length > 0 && (
            <div>
              {googleResults.map((s) => (
                <button
                  key={s.placeId}
                  type="button"
                  onClick={() => goToGooglePlace(s)}
                  style={rowStyle}
                >
                  <div style={{ fontWeight: 600 }}>{s.primary}</div>
                  {s.secondary && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {s.secondary}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {status === 'ready' && customResults.length > 0 && (
            <div>
              <div style={sectionHeaderStyle}>Community-added</div>
              {customResults.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => goToCustom(c)}
                  style={rowStyle}
                >
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
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
              No matches for &ldquo;{resultsForTerm}&rdquo;.
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
