'use client';
// Add a community cemetery when Google Places doesn't list it. Sign-in is
// optional: signed-in submitters get createdByUid; anonymous submitters must
// provide an email so we can reach them if the listing needs correction.
// See lib/cemeteries.ts for the CustomCemetery model and URL scheme.

import { FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/firebase';
import { loadGoogleMaps } from '@/lib/places';
import { createCustomCemetery, customPlaceIdOf } from '@/lib/cemeteries';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

// Fallback centre (Ireland) if we can't geolocate the user.
const FALLBACK_CENTER = { lat: 53.42, lng: -7.94 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AddCemeteryPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="form" label="Loading" />}>
      <AddCemeteryInner />
    </Suspense>
  );
}

function AddCemeteryInner() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const searchParams = useSearchParams();
  const router = useRouter();
  const prefillName = searchParams?.get('name') || '';

  const mapRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<any>(null);
  const [mapStatus, setMapStatus] = useState<'idle' | 'ready' | 'error' | 'no-key'>('idle');
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);

  useEffect(() => {
    // Waiting for auth state — but no redirect. Both signed-in and anonymous
    // are allowed. We just need to know which mode we're in to show the right
    // fields.
    if (user === undefined) return;

    let cancelled = false;

    loadGoogleMaps()
      .then(async (google) => {
        if (cancelled || !mapRef.current) return;
        await google.maps.importLibrary('maps');
        await google.maps.importLibrary('marker');

        // Start centred on the user's current location when possible so the
        // "I'm standing in the graveyard right now" case works with a single tap.
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
          zoom: start === FALLBACK_CENTER ? 7 : 17,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: 'cooperative',
          mapId: 'DEMO_MAP_ID',
        });

        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: start,
          gmpDraggable: true,
          title: 'Drag me to the cemetery entrance',
        });
        markerRef.current = marker;

        setPosition(start);
        setMapStatus('ready');

        marker.addListener('dragend', () => {
          const p = marker.position;
          if (!p) return;
          const lat = typeof p.lat === 'function' ? p.lat() : p.lat;
          const lng = typeof p.lng === 'function' ? p.lng() : p.lng;
          setPosition({ lat, lng });
        });

        map.addListener('click', (ev: any) => {
          if (!ev.latLng) return;
          const lat = ev.latLng.lat();
          const lng = ev.latLng.lng();
          marker.position = { lat, lng };
          setPosition({ lat, lng });
        });
      })
      .catch((err: Error) => {
        console.error('AddCemetery map error:', err);
        if (err.message.includes('not configured')) setMapStatus('no-key');
        else setMapStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (!position) {
      setError('Please place the pin on the map first.');
      return;
    }
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') || '').trim();
    const address = String(fd.get('address') || '').trim();
    const email = String(fd.get('email') || '').trim();
    if (!name) {
      setError('Please give the cemetery a name.');
      return;
    }
    // Anonymous submitters must give us an email for accountability.
    if (!user && !EMAIL_RE.test(email)) {
      setError('Please enter a valid email address so we can reach you if this listing needs correction.');
      return;
    }

    setSaving(true);
    try {
      const created = await createCustomCemetery({
        name,
        address: address || undefined,
        lat: position.lat,
        lng: position.lng,
        createdByUid: user?.uid,
        createdByEmail: user ? undefined : email,
      });

      router.push(`/cemetery/${customPlaceIdOf(created.id)}`);
    } catch (err: any) {
      console.error('createCustomCemetery failed:', err);
      setError(err?.message || 'Something went wrong. Please try again.');
      setSaving(false);
    }
  }

  if (user === undefined) {
    return <PageSkeleton variant="form" label="Loading" />;
  }

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">Add a cemetery</div>
        <h2 style={{ marginBottom: 8 }}>Help us list this place.</h2>
        <p className="muted">
          Many small church graveyards and older burial grounds aren&rsquo;t on
          Google&rsquo;s map. Add the location here and it will appear in search
          straight away — for you and for every other family looking for it.
        </p>

        <form onSubmit={submit}>
          <label htmlFor="name">Cemetery name</label>
          <input
            id="name"
            name="name"
            required
            autoFocus
            placeholder="St. Colman's Cemetery"
            defaultValue={prefillName}
          />

          <label htmlFor="address">
            Address <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            id="address"
            name="address"
            placeholder="Townland, town, county"
          />

          {!user && (
            <>
              <label htmlFor="email">Your email</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="you@example.com"
              />
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Not shown publicly. Only used if we need to reach you about
                this listing. <Link href={`/auth?next=${encodeURIComponent('/cemetery/add')}`} style={{ textDecoration: 'underline' }}>Sign in</Link> to skip this step.
              </p>
            </>
          )}

          <div className="fieldLabel" style={{ marginTop: 22 }}>Location on the map</div>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Drag the pin, or tap the map, to place it at the cemetery entrance.
            If you&rsquo;re standing there now, it should already be close.
          </p>
          <div
            ref={mapRef}
            role="application"
            aria-label="Map to position the cemetery pin"
            style={{
              width: '100%',
              height: 340,
              borderRadius: 18,
              border: '1px solid var(--line)',
              background: '#e6ece8',
              overflow: 'hidden',
              marginTop: 8,
            }}
          />
          {mapStatus === 'no-key' && (
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              Map isn&rsquo;t configured yet.
            </p>
          )}
          {mapStatus === 'error' && (
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              Map couldn&rsquo;t load. Please refresh and try again.
            </p>
          )}
          {position && mapStatus === 'ready' && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Pin: {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
            </p>
          )}

          {error && (
            <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{error}</p>
          )}

          <button
            disabled={saving || mapStatus !== 'ready'}
            className="button"
            style={{ width: '100%', marginTop: 26 }}
          >
            {saving ? 'Adding…' : 'Add this cemetery'}
          </button>

          <p className="muted" style={{ fontSize: 13, marginTop: 18, textAlign: 'center' }}>
            <Link href="/" style={{ textDecoration: 'underline' }}>
              ← Back to search
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
