'use client';
// Finds cemeteries close to the user's current location. See
// lib/cemetery-search for the merged Google + community implementation.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ButtonLink from '@/components/ButtonLink';
import {
  formatDistance,
  searchNearbyCemeteries,
  type NearbyCemetery,
} from '@/lib/cemetery-search';

export const dynamic = 'force-dynamic';

// How far out we'll look. 8 km covers "I'm standing here" plus a comfortable
// margin — larger radii dilute results with places in another town.
const SEARCH_RADIUS_METERS = 8000;
const MAX_RESULTS = 25;

type Status =
  | 'idle'
  | 'locating'
  | 'searching'
  | 'ready'
  | 'denied'
  | 'no-geolocation'
  | 'no-key'
  | 'error';

export default function NearbyCemeteriesPage() {
  const [status, setStatus] = useState<Status>('idle');
  const [results, setResults] = useState<NearbyCemetery[]>([]);
  const [error, setError] = useState('');
  // From the parishes page: picking a graveyard opens its registrar page.
  const [forRegistrar, setForRegistrar] = useState(false);
  useEffect(() => {
    setForRegistrar(new URLSearchParams(window.location.search).get('for') === 'registrar');
  }, []);
  const backHref = forRegistrar ? '/parishes#start' : '/';

  function hrefFor(r: NearbyCemetery): string {
    if (!forRegistrar) return `/cemetery/${encodeURIComponent(r.placeId)}`;
    const q = new URLSearchParams({ name: r.name, lat: String(r.lat), lng: String(r.lng) });
    if (r.address) q.set('address', r.address);
    return `/cemetery/${encodeURIComponent(r.placeId)}/registrar?${q.toString()}`;
  }

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!('geolocation' in navigator)) {
        setStatus('no-geolocation');
        return;
      }
      setStatus('locating');

      let coords: { lat: number; lng: number };
      try {
        coords = await new Promise<{ lat: number; lng: number }>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
            (err) => reject(err),
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
          );
        });
      } catch (err: any) {
        if (cancelled) return;
        if (err?.code === 1) setStatus('denied');
        else {
          setError(err?.message || 'Could not read your location.');
          setStatus('error');
        }
        return;
      }

      if (cancelled) return;
      setStatus('searching');

      try {
        const merged = await searchNearbyCemeteries(coords, {
          radiusMeters: SEARCH_RADIUS_METERS,
          maxResults: MAX_RESULTS,
        });
        if (cancelled) return;
        setResults(merged);
        setStatus('ready');
      } catch (err: any) {
        if (cancelled) return;
        console.error('Nearby search failed:', err);
        if (err?.message?.includes('not configured')) setStatus('no-key');
        else {
          setError(err?.message || 'Something went wrong.');
          setStatus('error');
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <div className="eyebrow">{forRegistrar ? 'For parishes' : 'Find someone'}</div>
      <h1 style={{ marginBottom: 8 }}>{forRegistrar ? 'Which graveyard do you look after?' : 'Graveyards near you'}</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 28 }}>
        {forRegistrar ? (
          <>
            These are the graveyards closest to you, nearest first. Tap yours to set up its
            register. Look after more than one? Set up one, then come back and tap the next. The
            same sign-in works for all of them.
          </>
        ) : (
          <>
            Cemeteries, church graveyards and burial grounds within roughly{' '}
            {Math.round(SEARCH_RADIUS_METERS / 1000)} km of where you are.
          </>
        )}
      </p>

      {status === 'locating' && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Finding your location…
          </p>
        </div>
      )}

      {status === 'searching' && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Looking for cemeteries near you…
          </p>
        </div>
      )}

      {status === 'denied' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Location permission needed</h3>
          <p className="muted">
            We ask your device for your location only to search from where you
            are, and only for this page. If you&rsquo;d rather not share it,
            you can search by name instead.
          </p>
          <ButtonLink href={backHref} className="button secondary small">
            Back to search
          </ButtonLink>
        </div>
      )}

      {status === 'no-geolocation' && (
        <div className="card">
          <p className="muted">
            This device doesn&rsquo;t support location. Please search by name
            or cemetery instead.
          </p>
          <ButtonLink href={backHref} className="button secondary small">
            Back to search
          </ButtonLink>
        </div>
      )}

      {status === 'no-key' && (
        <div className="card">
          <p className="muted">Search isn&rsquo;t configured yet.</p>
        </div>
      )}

      {status === 'error' && (
        <div className="card">
          <p className="muted">{error || 'Something went wrong. Please try again.'}</p>
        </div>
      )}

      {status === 'ready' && results.length === 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Nothing within {Math.round(SEARCH_RADIUS_METERS / 1000)} km</h3>
          <p className="muted">
            If you&rsquo;re standing in a graveyard right now that isn&rsquo;t
            listed, you can add it. It takes about a minute.
          </p>
          <ButtonLink href="/cemetery/add" className="button">
            Add this cemetery
          </ButtonLink>
        </div>
      )}

      {status === 'ready' && results.length > 0 && (
        <>
          <p className="muted" style={{ marginBottom: 18 }}>
            {results.length} within {Math.round(SEARCH_RADIUS_METERS / 1000)} km
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {results.map((r) => (
              <li key={`${r.source}:${r.placeId}`}>
                <Link
                  href={hrefFor(r)}
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
                  <div
                    className="muted"
                    style={{ fontSize: 13, whiteSpace: 'nowrap' }}
                    aria-label={`${formatDistance(r.distanceMeters)} away`}
                  >
                    {formatDistance(r.distanceMeters)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <div
            className="card"
            style={{ marginTop: 24, background: '#f7f4ee', borderColor: '#e0d8c8' }}
          >
            <p style={{ margin: 0, fontSize: 14 }}>
              Not seeing the graveyard you&rsquo;re looking for?
            </p>
            <ButtonLink href="/cemetery/add" className="button secondary small" style={{ marginTop: 10 }}>
              Add a cemetery
            </ButtonLink>
          </div>
        </>
      )}
    </main>
  );
}
