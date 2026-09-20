'use client';
// Lets a plot admin drop a pin on the exact grave within their cemetery.
// Big cemeteries have hundreds of plots, so cemetery-level coordinates only
// get families to the gate — this pin closes the last 200 metres.
//
// The editor is idempotent: opening it hydrates from the plot doc, so the
// current pin (if any) is where the marker starts. Saves write directly to
// Firestore under the plots admin rule.

import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { loadGoogleMaps } from '@/lib/places';
import { updatePlotLocation } from '@/lib/plot';
import { writeAudit } from '@/lib/audit';
import type { Cemetery, Plot } from '@/lib/types';

type Props = {
  plotId: string;
  cemetery: Cemetery;
  actorUid: string;
  actorEmail?: string;
};

export default function PlotLocationEditor({ plotId, cemetery, actorUid, actorEmail }: Props) {
  const [plot, setPlot] = useState<Plot | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!db) return;
    return onSnapshot(doc(db, 'plots', plotId), (snap) => {
      if (!snap.exists()) return;
      setPlot({ id: snap.id, ...(snap.data() as Omit<Plot, 'id'>) });
    });
  }, [plotId]);

  const hasPin = typeof plot?.lat === 'number' && typeof plot?.lng === 'number';

  async function save(coords: { lat: number; lng: number }) {
    setSaving(true);
    setError('');
    try {
      await updatePlotLocation(plotId, coords);
      await writeAudit({
        entityType: 'plot',
        entityId: plotId,
        action: 'location_set',
        actorUid,
        actorEmail,
        details: { lat: coords.lat, lng: coords.lng },
      });
      setEditing(false);
    } catch (err: any) {
      setError(err?.message || 'Could not save the grave location.');
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!confirm('Remove the exact grave location? Directions will only go to the cemetery gate.')) return;
    setSaving(true);
    setError('');
    try {
      await updatePlotLocation(plotId, null);
      await writeAudit({
        entityType: 'plot',
        entityId: plotId,
        action: 'location_cleared',
        actorUid,
        actorEmail,
      });
    } catch (err: any) {
      setError(err?.message || 'Could not clear the location.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 30 }}>
      <div className="eyebrow">Exact grave location</div>
      <h3 style={{ marginTop: 10 }}>
        {hasPin ? 'Walking directions are set' : 'Help visitors find the grave'}
      </h3>
      {hasPin ? (
        <>
          <p className="muted">
            Anyone visiting the memorial page can now tap &ldquo;Directions to the grave&rdquo; and
            walk straight there. No more wandering the cemetery searching for a headstone.
          </p>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Pin: {plot!.lat!.toFixed(5)}, {plot!.lng!.toFixed(5)}
          </p>
        </>
      ) : (
        <p className="muted">
          Add a pin on the map so family and friends can walk straight to the grave. Especially
          helpful in larger cemeteries where the headstone can take a while to find.
        </p>
      )}

      {!editing ? (
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button type="button" className="button" onClick={() => setEditing(true)}>
            {hasPin ? 'Update the location' : 'Set the location'}
          </button>
          {hasPin && (
            <button
              type="button"
              className="button secondary"
              onClick={clear}
              disabled={saving}
            >
              Remove pin
            </button>
          )}
        </div>
      ) : (
        <PickerMap
          cemetery={cemetery}
          startCoords={hasPin ? { lat: plot!.lat!, lng: plot!.lng! } : null}
          saving={saving}
          onSave={save}
          onCancel={() => {
            setEditing(false);
            setError('');
          }}
        />
      )}

      {error && (
        <p style={{ color: '#a94442', marginTop: 12, fontSize: 14 }}>{error}</p>
      )}
    </div>
  );
}

function PickerMap({
  cemetery,
  startCoords,
  saving,
  onSave,
  onCancel,
}: {
  cemetery: Cemetery;
  startCoords: { lat: number; lng: number } | null;
  saving: boolean;
  onSave: (coords: { lat: number; lng: number }) => void;
  onCancel: () => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<any>(null);
  const [status, setStatus] = useState<'idle' | 'ready' | 'error' | 'no-key' | 'no-center'>('idle');
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(startCoords);

  useEffect(() => {
    // Fall back to the cemetery centre if no existing pin. Cemeteries added
    // via Google Places sometimes have null coords; we handle that gracefully
    // rather than dropping the marker at 0,0.
    const center =
      startCoords ??
      (typeof cemetery.lat === 'number' && typeof cemetery.lng === 'number'
        ? { lat: cemetery.lat, lng: cemetery.lng }
        : null);

    if (!center) {
      setStatus('no-center');
      return;
    }

    let cancelled = false;
    loadGoogleMaps()
      .then(async (google) => {
        if (cancelled || !mapRef.current) return;
        await google.maps.importLibrary('maps');
        await google.maps.importLibrary('marker');

        const map = new google.maps.Map(mapRef.current, {
          center,
          zoom: 19,
          mapTypeId: 'hybrid',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: 'cooperative',
          mapId: 'DEMO_MAP_ID',
        });

        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: center,
          gmpDraggable: true,
          title: 'Drag to the exact grave',
        });
        markerRef.current = marker;
        setPosition(center);
        setStatus('ready');

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
        console.error('PlotLocationEditor map error:', err);
        if (err.message.includes('not configured')) setStatus('no-key');
        else setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [cemetery.lat, cemetery.lng, startCoords]);

  return (
    <div style={{ marginTop: 14 }}>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Drag the pin, or tap the map, to place it on the headstone. Satellite view helps.
        Graveyards look distinctive from above.
      </p>
      <div
        ref={mapRef}
        role="application"
        aria-label="Map to position the grave pin"
        style={{
          width: '100%',
          height: 380,
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
          Map couldn&rsquo;t load. Please refresh and try again.
        </p>
      )}
      {status === 'no-center' && (
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          We don&rsquo;t have coordinates for this cemetery yet, so we can&rsquo;t centre the
          map. Please contact us and we&rsquo;ll sort it out.
        </p>
      )}
      {position && status === 'ready' && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Pin: {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
        </p>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="button"
          disabled={saving || !position || status !== 'ready'}
          onClick={() => position && onSave(position)}
        >
          {saving ? 'Saving…' : 'Save grave location'}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
