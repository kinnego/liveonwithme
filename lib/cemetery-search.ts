// Shared helpers for "cemeteries near a point" searches. Used by
// /cemetery/nearby, /cemetery/pick, and the CemeteryPicker fallback UI.
// Merges Google Places nearby results with community-added cemeteries,
// returning them sorted by distance from the origin point.

import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { loadGoogleMaps } from './places';
import { CUSTOM_PLACE_ID_PREFIX } from './cemeteries';
import type { CustomCemetery } from './types';

export type NearbyCemeterySource = 'google' | 'community';

export type NearbyCemetery = {
  placeId: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  source: NearbyCemeterySource;
};

export type NearbySearchOptions = {
  /** Radius in metres. Nearby Search caps at 50_000. */
  radiusMeters: number;
  /** Cap returned results after sort/merge. */
  maxResults?: number;
};

export async function searchNearbyCemeteries(
  coords: { lat: number; lng: number },
  opts: NearbySearchOptions,
): Promise<NearbyCemetery[]> {
  const [googleResults, customResults] = await Promise.all([
    fetchGoogleNearby(coords, opts.radiusMeters),
    fetchNearbyCustom(coords, opts.radiusMeters),
  ]);
  const merged = [...googleResults, ...customResults].sort(
    (a, b) => a.distanceMeters - b.distanceMeters,
  );
  return opts.maxResults ? merged.slice(0, opts.maxResults) : merged;
}

async function fetchGoogleNearby(
  coords: { lat: number; lng: number },
  radiusMeters: number,
): Promise<NearbyCemetery[]> {
  const google = await loadGoogleMaps();
  await google.maps.importLibrary('places');
  const { Place } = google.maps.places;
  const { places } = await Place.searchNearby({
    fields: ['id', 'displayName', 'formattedAddress', 'location'],
    locationRestriction: { center: coords, radius: radiusMeters },
    // Nearby Search doesn't accept `place_of_worship` as a primary type —
    // `church` covers most Irish/UK churchyards. Older graveyards not tagged
    // as a church won't appear; that's what "Add a cemetery" is for.
    includedPrimaryTypes: ['cemetery', 'church'],
    maxResultCount: 20,
    rankPreference: 'DISTANCE',
  });
  if (!Array.isArray(places)) return [];
  return places
    .map((p: any): NearbyCemetery | null => {
      if (!p.id || !p.location) return null;
      const lat = typeof p.location.lat === 'function' ? p.location.lat() : p.location.lat;
      const lng = typeof p.location.lng === 'function' ? p.location.lng() : p.location.lng;
      return {
        placeId: p.id,
        name: p.displayName || 'Unnamed place',
        address: p.formattedAddress || undefined,
        lat,
        lng,
        distanceMeters: haversineMeters(coords, { lat, lng }),
        source: 'google',
      };
    })
    .filter(Boolean) as NearbyCemetery[];
}

async function fetchNearbyCustom(
  coords: { lat: number; lng: number },
  radiusMeters: number,
): Promise<NearbyCemetery[]> {
  if (!db) return [];
  // Client-side Haversine filter — fine while we're under a few hundred
  // community entries; swap in a geohash prefix query if we outgrow that.
  const snap = await getDocs(collection(db, 'cemeteries'));
  return snap.docs
    .map((d): NearbyCemetery | null => {
      const c = d.data() as CustomCemetery;
      if (typeof c.lat !== 'number' || typeof c.lng !== 'number') return null;
      const distanceMeters = haversineMeters(coords, { lat: c.lat, lng: c.lng });
      if (distanceMeters > radiusMeters) return null;
      return {
        placeId: `${CUSTOM_PLACE_ID_PREFIX}${d.id}`,
        name: c.name,
        address: c.address,
        lat: c.lat,
        lng: c.lng,
        distanceMeters,
        source: 'community',
      };
    })
    .filter(Boolean) as NearbyCemetery[];
}

export function requestCurrentCoords(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation not supported on this device'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}
