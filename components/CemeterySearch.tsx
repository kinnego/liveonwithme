'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadGoogleMaps } from '@/lib/places';

export default function CemeterySearch() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'idle' | 'ready' | 'no-key' | 'error'>('idle');
  const router = useRouter();

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
          includedRegionCodes: ['ie', 'gb'],
          includedPrimaryTypes: ['cemetery'],
        });
        element.style.width = '100%';

        handler = async (event: any) => {
          const prediction = event.placePrediction;
          if (!prediction) return;
          const place = prediction.toPlace();
          await place.fetchFields({ fields: ['id', 'displayName'] });
          const id = place.id;
          if (!id) return;
          const q = place.displayName ? `?name=${encodeURIComponent(place.displayName)}` : '';
          router.push(`/cemetery/${encodeURIComponent(id)}${q}`);
        };

        element.addEventListener('gmp-select', handler);
        containerRef.current.replaceChildren(element);
        setStatus('ready');
      })
      .catch((err: Error) => {
        console.error('CemeterySearch load error:', err);
        if (err.message.includes('not configured')) setStatus('no-key');
        else setStatus('error');
      });

    return () => {
      cancelled = true;
      if (element && handler) element.removeEventListener('gmp-select', handler);
      element?.remove();
    };
  }, [router]);

  return (
    <div>
      <div ref={containerRef} style={{ display: status === 'ready' ? 'block' : 'none' }} />
      {status !== 'ready' && (
        <input
          placeholder="Search a cemetery in Ireland or the UK…"
          disabled
          aria-label="Cemetery search — loading"
        />
      )}
      {status === 'no-key' && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Search isn&rsquo;t configured yet.
        </p>
      )}
      {status === 'error' && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Search couldn&rsquo;t load. Please refresh.
        </p>
      )}
    </div>
  );
}
