'use client';
// Lets a visitor tap a spot on the map and we show every cemetery and
// churchyard within a short radius of that pin. Useful when a name search
// isn't finding the right place — older burial grounds often aren't tagged
// as `cemetery` on Google, so the autocomplete filter hides them.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ButtonLink from '@/components/ButtonLink';
import { loadGoogleMaps } from '@/lib/places';
import {
  formatDistance,
  searchNearbyCemeteries,
  type NearbyCemetery,
} from '@/lib/cemetery-search';

export const dynamic = 'force-dynamic';

const FALLBACK_CENTER = { lat: 53.42, lng: -7.94 };
const SEARCH_RADIUS_METERS = 600;
const MAX_RESULTS = 10;

type Status = 'loading' | 'ready' | 'searching' | 'error' | 'no-key';

export default function PickCemeteryPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<any>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [results, setResults] = useState<NearbyCemetery[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then(async (google) => {
        if (cancelled || !mapRef.current) return;
        await google.maps.importLibrary('maps');
        await google.maps.importLibrary('marker');
        await google.maps.importLibrary('places');

        const start = await new Promise<{ lat: number; lng: number }>((resolve) => {
          if (!navigator.geolocation) return resolve(FALLBACK_CENTER);
          const timeout = setTimeout(() => resolve(FALLBACK_CENTER), 4000);
          navigator.geolocation.getCurrentPosition(
            (p) => {
              clearTimeout(timeout);
              resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
            },
            () => {
              clearTimeout(timeout);
              resolve(FALLBACK_CENTER);
            },
            { enableHighAccuracy: true, timeout: 4000, maximumAge: 60_000 },
          );
        });
        if (cancelled || !mapRef.current) return;

        const map = new google.maps.Map(mapRef.current, {
          center: start,
          zoom: start === FALLBACK_CENTER ? 7 : 15,
          mapTypeId: 'hybrid',
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: 'cooperative',
          mapId: 'DEMO_MAP_ID',
        });

        setStatus('ready');

        map.addListener('click', (ev: any) => {
          if (!ev.latLng) return;
          const lat = ev.latLng.lat();
          const lng = ev.latLng.lng();
          placePin(google, map, { lat, lng });
        });
      })
      .catch((err: Error) => {
        console.error('PickCemetery map error:', err);
        if (err.message.includes('not configured')) setStatus('no-key');
        else setStatus('error');
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function placePin(google: any, map: any, coords: { lat: number; lng: number }) {
    if (!markerRef.current) {
      markerRef.current = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: coords,
        gmpDraggable: true,
        title: 'Drag or tap to move',
      });
      markerRef.current.addListener('dragend', () => {
        const p = markerRef.current.position;
        if (!p) return;
        const lat = typeof p.lat === 'function' ? p.lat() : p.lat;
        const lng = typeof p.lng === 'function' ? p.lng() : p.lng;
        const next = { lat, lng };
        setPin(next);
        runSearch(next);
      });
    } else {
      markerRef.current.position = coords;
    }
    setPin(coords);
    runSearch(coords);
  }

  async function runSearch(coords: { lat: number; lng: number }) {
    setStatus('searching');
    setResults(null);
    setError('');
    try {
      const merged = await searchNearbyCemeteries(coords, {
        radiusMeters: SEARCH_RADIUS_METERS,
        maxResults: MAX_RESULTS,
      });
      setResults(merged);
      setStatus('ready');
    } catch (err: any) {
      console.error('Pick cemetery search failed:', err);
      setError(err?.message || 'Could not search around that spot.');
      setStatus('ready');
    }
  }

  const addHref = pin
    ? `/cemetery/add?lat=${pin.lat.toFixed(6)}&lng=${pin.lng.toFixed(6)}`
    : '/cemetery/add';

  return (
    <main className="shell">
      <div className="eyebrow">Find someone</div>
      <h1 style={{ marginBottom: 8 }}>Pick the cemetery on a map</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
        If a name search isn&rsquo;t finding the right place, zoom in and tap the spot — we&rsquo;ll
        show every cemetery and churchyard within about {SEARCH_RADIUS_METERS}&nbsp;m. Satellite
        view helps: graveyards look distinctive from above.
      </p>

      <div
        ref={mapRef}
        role="application"
        aria-label="Map — tap a spot to search for cemeteries nearby"
        style={{
          width: '100%',
          height: 460,
          borderRadius: 18,
          border: '1px solid var(--line)',
          background: '#e6ece8',
          overflow: 'hidden',
          marginBottom: 20,
        }}
      />

      {status === 'no-key' && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Map isn&rsquo;t configured yet.</p>
        </div>
      )}
      {status === 'error' && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Map couldn&rsquo;t load. Please refresh and try again.</p>
        </div>
      )}

      {status === 'ready' && !pin && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Tap any spot on the map to search around it.
          </p>
        </div>
      )}

      {status === 'searching' && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Searching the spot…</p>
        </div>
      )}

      {status === 'ready' && results && results.length > 0 && (
        <>
          <p className="muted" style={{ marginBottom: 14 }}>
            {results.length} {results.length === 1 ? 'match' : 'matches'} within{' '}
            {SEARCH_RADIUS_METERS}&nbsp;m of the pin.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {results.map((r) => (
              <li key={`${r.source}:${r.placeId}`}>
                <Link
                  href={`/cemetery/${encodeURIComponent(r.placeId)}`}
                  className="card"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    padding: '16px 20px',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 17 }}>{r.name}</div>
                    {r.address && (
                      <div
                        className="muted"
                        style={{ fontSize: 13, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {r.address}
                      </div>
                    )}
                    {r.source === 'community' && (
                      <div
                        style={{
                          display: 'inline-block',
                          marginTop: 6,
                          fontSize: 11,
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
                  <div className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                    {formatDistance(r.distanceMeters)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div
            className="card"
            style={{ marginTop: 20, background: '#f7f4ee', borderColor: '#e0d8c8' }}
          >
            <p style={{ margin: 0, fontSize: 14 }}>Not the one you&rsquo;re looking for?</p>
            <ButtonLink href={addHref} className="button secondary small" style={{ marginTop: 10 }}>
              Add a cemetery at this pin
            </ButtonLink>
          </div>
        </>
      )}

      {status === 'ready' && results && results.length === 0 && pin && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>No cemetery here on the map</h3>
          <p className="muted">
            Nothing within {SEARCH_RADIUS_METERS}&nbsp;m of the pin. If you know there&rsquo;s a
            burial ground at this spot, add it here — it only takes a minute.
          </p>
          <ButtonLink href={addHref} className="button">
            Add a cemetery at this pin
          </ButtonLink>
        </div>
      )}

      {error && (
        <p style={{ color: '#a94442', marginTop: 12, fontSize: 14 }}>{error}</p>
      )}

      <p className="muted" style={{ fontSize: 13, marginTop: 24, textAlign: 'center' }}>
        <Link href="/" style={{ textDecoration: 'underline' }}>← Back to search</Link>
      </p>
    </main>
  );
}

