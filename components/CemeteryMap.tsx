'use client';
// Renders a Google map centred on a cemetery. Given a Google Place ID we can
// look up coordinates via Places; for community-added cemeteries the caller
// passes lat/lng directly (isCustom=true) so we skip the Places lookup and
// point the directions link at the coordinates instead of a nonexistent
// Google place.

import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/places';
import { isCustomPlaceId } from '@/lib/cemeteries';

type Props = {
  placeId: string;
  name?: string;
  lat?: number | null;
  lng?: number | null;
};

export default function CemeteryMap({ placeId, name, lat, lng }: Props) {
  const isCustom = isCustomPlaceId(placeId);
  const mapRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'idle' | 'ready' | 'error' | 'no-key'>('idle');

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then(async (google) => {
        if (cancelled || !mapRef.current) return;
        await google.maps.importLibrary('maps');
        await google.maps.importLibrary('marker');

        let center: { lat: number; lng: number } | null =
          typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;

        if (!center && !isCustom) {
          await google.maps.importLibrary('places');
          const place = new google.maps.places.Place({ id: placeId });
          await place.fetchFields({ fields: ['location'] });
          const loc = place.location;
          if (loc) center = { lat: loc.lat(), lng: loc.lng() };
        }

        if (cancelled || !mapRef.current || !center) return;

        const map = new google.maps.Map(mapRef.current, {
          center,
          zoom: 16,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: 'cooperative',
          mapId: 'DEMO_MAP_ID',
        });

        new google.maps.marker.AdvancedMarkerElement({
          map,
          position: center,
          title: name || 'Cemetery',
        });

        setStatus('ready');
      })
      .catch((err: Error) => {
        console.error('CemeteryMap load error:', err);
        if (err.message.includes('not configured')) setStatus('no-key');
        else setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [placeId, name, lat, lng]);

  const directionsHref = isCustom
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        typeof lat === 'number' && typeof lng === 'number' ? `${lat},${lng}` : name || 'Cemetery',
      )}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        name || 'Cemetery',
      )}&destination_place_id=${encodeURIComponent(placeId)}`;

  return (
    <div style={{ marginBottom: 30 }}>
      <div
        ref={mapRef}
        aria-label={name ? `Map showing ${name}` : 'Map showing the cemetery'}
        role="img"
        style={{
          width: '100%',
          height: 340,
          borderRadius: 18,
          border: '1px solid var(--line)',
          background: '#e6ece8',
          overflow: 'hidden',
        }}
      />
      {status === 'no-key' && (
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Map isn&rsquo;t configured yet.
        </p>
      )}
      {status === 'error' && (
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Map couldn&rsquo;t load. Please refresh.
        </p>
      )}
      {status === 'ready' && (
        <p style={{ marginTop: 10, fontSize: 14 }}>
          <a
            href={directionsHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'underline' }}
          >
            Get directions on Google Maps →
          </a>
        </p>
      )}
    </div>
  );
}
