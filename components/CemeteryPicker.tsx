'use client';
import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/places';
import type { Cemetery } from '@/lib/types';

type Props = {
  value: Cemetery | null | undefined;
  onChange: (v: Cemetery | null) => void;
};

export default function CemeteryPicker({ value, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'idle' | 'ready' | 'no-key' | 'error'>('idle');

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

  return (
    <div>
      <div ref={containerRef} style={{ display: status === 'ready' ? 'block' : 'none' }} />
      {status !== 'ready' && (
        <input
          defaultValue={value?.name || ''}
          placeholder="Search for the cemetery in Ireland or the UK…"
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
            style={{
              background: 'none',
              border: 0,
              padding: 0,
              color: 'var(--sage)',
              cursor: 'pointer',
              textDecoration: 'underline',
              marginLeft: 6,
              fontSize: 13,
            }}
          >
            Clear
          </button>
        </p>
      )}
    </div>
  );
}
