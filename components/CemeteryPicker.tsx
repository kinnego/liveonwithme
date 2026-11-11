'use client';
// Cemetery chooser used inside memorial/plot forms. Combines Google's
// PlaceAutocompleteElement with an inline "Show cemeteries near me" fallback,
// because Google's cemetery index misses many church graveyards and older
// burial grounds — if a keeper can't find it by typing, we show a nearby
// list they can tap.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/places';
import {
  formatDistance,
  requestCurrentCoords,
  searchNearbyCemeteries,
  type NearbyCemetery,
} from '@/lib/cemetery-search';
import type { Cemetery } from '@/lib/types';

type Props = {
  value: Cemetery | null | undefined;
  onChange: (v: Cemetery | null) => void;
};

// Radius for the fallback list. Big enough to cover the user's town but
// not so wide that irrelevant places show up first.
const NEARBY_RADIUS_METERS = 8000;
const NEARBY_MAX_RESULTS = 15;

type NearbyStatus =
  | 'hidden'
  | 'locating'
  | 'searching'
  | 'ready'
  | 'denied'
  | 'no-geolocation'
  | 'error';

export default function CemeteryPicker({ value, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'idle' | 'ready' | 'no-key' | 'error'>('idle');

  const [nearbyStatus, setNearbyStatus] = useState<NearbyStatus>('hidden');
  const [nearbyResults, setNearbyResults] = useState<NearbyCemetery[]>([]);
  const [nearbyError, setNearbyError] = useState('');

  useEffect(() => {
    let element: any;
    let handler: any;
    let cancelled = false;

    loadGoogleMaps()
      .then(async (google) => {
        if (cancelled) return;
        await google.maps.importLibrary('places');
        if (cancelled || !containerRef.current) return;

        const PlaceAutocompleteElement = google.maps.places?.PlaceAutocompleteElement;
        if (!PlaceAutocompleteElement) {
          throw new Error('PlaceAutocompleteElement unavailable — enable Places API (New)');
        }

        element = new PlaceAutocompleteElement({
          // Worldwide; Google ranks places near the visitor first.
          includedPrimaryTypes: ['cemetery'],
        });
        element.style.width = '100%';
        if (value?.name) element.value = value.name;

        handler = async (event: any) => {
          const prediction = event.placePrediction;
          if (!prediction) return;
          const place = prediction.toPlace();
          await place.fetchFields({
            fields: ['id', 'displayName', 'formattedAddress', 'location'],
          });
          onChange({
            name: place.displayName || '',
            address: place.formattedAddress || '',
            placeId: place.id || '',
            lat: place.location?.lat() ?? null,
            lng: place.location?.lng() ?? null,
          });
        };

        element.addEventListener('gmp-select', handler);
        containerRef.current.replaceChildren(element);
        setStatus('ready');
      })
      .catch((err: Error) => {
        console.error('CemeteryPicker load error:', err);
        if (err.message.includes('not configured')) setStatus('no-key');
        else setStatus('error');
      });

    return () => {
      cancelled = true;
      if (element && handler) element.removeEventListener('gmp-select', handler);
      element?.remove();
    };
    // Mount once — parent renders us only after cemetery is loaded, so initial value is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);

  function handleManualBlur(e: React.FocusEvent<HTMLInputElement>) {
    if (status === 'ready') return;
    const name = e.target.value.trim();
    if (!name) {
      onChange(null);
      return;
    }
    onChange({ name, address: '', placeId: '', lat: null, lng: null });
  }

  function clearSelection() {
    onChange(null);
    const el = containerRef.current?.firstElementChild as any;
    if (el && 'value' in el) el.value = '';
  }

  async function showNearby() {
    setNearbyError('');
    setNearbyResults([]);
    setNearbyStatus('locating');
    try {
      const coords = await requestCurrentCoords();
      setNearbyStatus('searching');
      const merged = await searchNearbyCemeteries(coords, {
        radiusMeters: NEARBY_RADIUS_METERS,
        maxResults: NEARBY_MAX_RESULTS,
      });
      setNearbyResults(merged);
      setNearbyStatus('ready');
    } catch (err: any) {
      if (err?.code === 1) {
        setNearbyStatus('denied');
        return;
      }
      if (err?.message?.includes('Geolocation not supported')) {
        setNearbyStatus('no-geolocation');
        return;
      }
      console.error('CemeteryPicker nearby lookup failed:', err);
      setNearbyError(err?.message || 'Could not find cemeteries near you.');
      setNearbyStatus('error');
    }
  }

  function pickNearby(r: NearbyCemetery) {
    onChange({
      name: r.name,
      address: r.address || '',
      placeId: r.placeId,
      lat: r.lat,
      lng: r.lng,
    });
    // Reflect the chosen name back into the autocomplete input so the user
    // sees their selection even if the nearby list collapses later.
    const el = containerRef.current?.firstElementChild as any;
    if (el && 'value' in el) el.value = r.name;
    setNearbyStatus('hidden');
  }

  return (
    <div>
      <div ref={containerRef} style={{ display: status === 'ready' ? 'block' : 'none' }} />
      {status !== 'ready' && (
        <input
          defaultValue={value?.name || ''}
          placeholder="Search for the cemetery…"
          onBlur={handleManualBlur}
        />
      )}
      {status === 'no-key' && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Cemetery search isn&rsquo;t available yet — enter the cemetery name manually and save.
        </p>
      )}
      {status === 'error' && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Search couldn&rsquo;t load. You can still enter a name.
        </p>
      )}
      {value?.address && (
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          {value.address}
          {'  '}
          <button
            type="button"
            onClick={clearSelection}
            style={textLinkStyle}
          >
            Clear
          </button>
        </p>
      )}

      {status === 'ready' && (
        <div style={{ marginTop: 10 }}>
          {nearbyStatus === 'hidden' && (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              Can&rsquo;t find it?{' '}
              <button type="button" onClick={showNearby} style={textLinkStyle}>
                Show cemeteries near me
              </button>{' '}
              or{' '}
              <Link
                href="/cemetery/pick"
                style={{ color: 'var(--brand)', textDecoration: 'underline' }}
                target="_blank"
                rel="noopener"
              >
                pick the spot on a map
              </Link>
              .
            </p>
          )}

          {nearbyStatus === 'locating' && (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>Finding your location…</p>
          )}
          {nearbyStatus === 'searching' && (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>Looking for cemeteries nearby…</p>
          )}
          {nearbyStatus === 'denied' && (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              We can&rsquo;t show nearby results without your location.{' '}
              <Link
                href="/cemetery/pick"
                style={{ color: 'var(--brand)', textDecoration: 'underline' }}
                target="_blank"
                rel="noopener"
              >
                Pick the spot on a map
              </Link>{' '}
              instead.
            </p>
          )}
          {nearbyStatus === 'no-geolocation' && (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              This device doesn&rsquo;t support location.{' '}
              <Link
                href="/cemetery/pick"
                style={{ color: 'var(--brand)', textDecoration: 'underline' }}
                target="_blank"
                rel="noopener"
              >
                Pick the spot on a map
              </Link>{' '}
              instead.
            </p>
          )}
          {nearbyStatus === 'error' && (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>{nearbyError}</p>
          )}

          {nearbyStatus === 'ready' && nearbyResults.length === 0 && (
            <div
              style={{
                padding: 14,
                border: '1px solid var(--line)',
                borderRadius: 12,
                background: '#faf7f0',
              }}
            >
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                Nothing within {Math.round(NEARBY_RADIUS_METERS / 1000)}&nbsp;km of you.{' '}
                <Link
                  href="/cemetery/pick"
                  style={{ color: 'var(--brand)', textDecoration: 'underline' }}
                  target="_blank"
                  rel="noopener"
                >
                  Try picking the spot on a map
                </Link>
                .
              </p>
            </div>
          )}

          {nearbyStatus === 'ready' && nearbyResults.length > 0 && (
            <div
              style={{
                marginTop: 4,
                border: '1px solid var(--line)',
                borderRadius: 12,
                overflow: 'hidden',
                background: 'white',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  padding: '10px 14px',
                  background: '#fbf8f2',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <span
                  className="eyebrow"
                  style={{ marginBottom: 0, fontSize: 11 }}
                >
                  {nearbyResults.length} near you
                </span>
                <button
                  type="button"
                  onClick={() => setNearbyStatus('hidden')}
                  style={{ ...textLinkStyle, fontSize: 12 }}
                >
                  Hide
                </button>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {nearbyResults.map((r) => (
                  <li key={`${r.source}:${r.placeId}`}>
                    <button
                      type="button"
                      onClick={() => pickNearby(r)}
                      style={rowButtonStyle}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{r.name}</div>
                        {r.address && (
                          <div
                            className="muted"
                            style={{
                              fontSize: 12,
                              marginTop: 2,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {r.address}
                          </div>
                        )}
                        {r.source === 'community' && (
                          <div
                            style={{
                              display: 'inline-block',
                              marginTop: 4,
                              fontSize: 10,
                              letterSpacing: '0.12em',
                              textTransform: 'uppercase',
                              fontWeight: 800,
                              color: 'var(--sage)',
                            }}
                          >
                            Community-added
                          </div>
                        )}
                      </div>
                      <div
                        className="muted"
                        style={{ fontSize: 12, whiteSpace: 'nowrap', marginLeft: 12 }}
                      >
                        {formatDistance(r.distanceMeters)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              <div
                style={{
                  padding: '10px 14px',
                  borderTop: '1px solid var(--line)',
                  background: '#f7f4ee',
                }}
              >
                <Link
                  href="/cemetery/pick"
                  target="_blank"
                  rel="noopener"
                  style={{ color: 'var(--sage)', textDecoration: 'none', fontWeight: 600, fontSize: 13 }}
                >
                  Still not seeing it? Pick the spot on a map →
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const textLinkStyle: React.CSSProperties = {
  background: 'none',
  border: 0,
  padding: 0,
  color: 'var(--brand)',
  cursor: 'pointer',
  textDecoration: 'underline',
  font: 'inherit',
  fontSize: 'inherit',
};

const rowButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: '12px 14px',
  border: 0,
  borderTop: '1px solid var(--line)',
  background: 'white',
  textAlign: 'left',
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
};
