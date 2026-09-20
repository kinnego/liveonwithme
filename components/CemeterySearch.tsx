'use client';
// Unified cemetery search — Google Places suggestions and community-added
// cemeteries appear together in one dropdown so families never have to guess
// which "side" to search. Small church graveyards and older burial grounds
// often aren't on Google, so we always offer an "Add a cemetery" fallback.
//
// Search runs on submit (Enter or the search button), not per keystroke.
// Google Places autocomplete is metered — firing it on every debounced
// keystroke was multiplying our bill for very little UX gain.

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

export default function CemeterySearch() {
  const [term, setTerm] = useState('');
  const [submittedTerm, setSubmittedTerm] = useState('');
  const [googleResults, setGoogleResults] = useState<GoogleSuggestion[]>([]);
  const [customResults, setCustomResults] = useState<CustomCemetery[]>([]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'searching' | 'ready' | 'no-key' | 'error'>('idle');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const googleRef = useRef<any>(null);
  const sessionTokenRef = useRef<any>(null);
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
    setSubmittedTerm(q);
    setStatus('searching');
    setOpen(true);
    try {
      const [googleData, customData] = await Promise.all([
        fetchGoogleSuggestions(q),
        searchCustomCemeteries(q, 5).catch(() => [] as CustomCemetery[]),
      ]);
      setGoogleResults(googleData);
      setCustomResults(customData);
      setStatus('ready');
    } catch (err) {
      console.error('CemeterySearch query error:', err);
      setStatus('error');
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = term.trim();
    if (q.length < 2) return;
    runSearch(q);
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

  // Only show the dropdown once a search has been submitted, and only while
  // the user hasn't edited the term since. Editing after a search hides the
  // dropdown to signal that the visible results are stale.
  const showDropdown =
    open &&
    submittedTerm.length >= 2 &&
    term.trim() === submittedTerm &&
    status !== 'idle';
  const hasAnyResults = googleResults.length > 0 || customResults.length > 0;
  const addHref = `/cemetery/add${term.trim() ? `?name=${encodeURIComponent(term.trim())}` : ''}`;
  const canSubmit = term.trim().length >= 2 && status !== 'no-key';

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8 }}>
        <input
          type="search"
          placeholder="Search a cemetery in Ireland or the UK…"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
          }}
          onFocus={() => {
            if (submittedTerm && term.trim() === submittedTerm) setOpen(true);
          }}
          aria-label="Cemetery search"
          autoComplete="off"
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          className="button"
          disabled={!canSubmit}
          style={{ padding: '0 20px' }}
        >
          Search
        </button>
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
              No matches for &ldquo;{submittedTerm}&rdquo;.
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
