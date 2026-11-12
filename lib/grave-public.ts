// What the public can see of a grave in a parish burial register. Anyone can
// search the registers and open a grave's page to find it and get directions.
// Registrar-only details (private notes, who uploaded what) stay out.

import type { GraveRecord } from './types';
import { graveLabel } from './grave-match';

export interface PublicBurial {
  name: string;
  nickname: string;
  born: string;
  died: string;
  age: string;
  address: string;
  relations: string;
}

export interface PublicGrave {
  id: string;
  placeId: string;
  cemeteryName: string;
  cemeteryAddress: string;
  cemeteryLat: number | null;
  cemeteryLng: number | null;
  label: string;
  burials: PublicBurial[];
  inscription: string;
  /** Headstone photo, a key in the public R2 bucket. */
  photoPath: string | null;
  lat: number | null;
  lng: number | null;
  /** The family's plot page, once a family has adopted the grave. */
  plotId: string | null;
}

export function publicBurial(b: GraveRecord['burials'][number]): PublicBurial {
  return {
    name: [b.forenames, b.surname].filter(Boolean).join(' '),
    nickname: b.nickname || '',
    born: b.born || '',
    died: b.died || (b.diedYear ? String(b.diedYear) : ''),
    age: b.age || '',
    address: b.address || '',
    relations: b.relations || '',
  };
}

export function publicGrave(id: string, g: Partial<GraveRecord>): PublicGrave {
  const c = g.cemetery;
  return {
    id,
    placeId: g.placeId || c?.placeId || '',
    cemeteryName: c?.name || '',
    cemeteryAddress: c?.address || '',
    cemeteryLat: typeof c?.lat === 'number' ? c.lat : null,
    cemeteryLng: typeof c?.lng === 'number' ? c.lng : null,
    label: graveLabel(g),
    burials: (g.burials || []).map(publicBurial),
    inscription: g.inscription || '',
    photoPath: g.photoPath || null,
    lat: typeof g.lat === 'number' ? g.lat : null,
    lng: typeof g.lng === 'number' ? g.lng : null,
    plotId: g.status === 'adopted' ? g.adoptedPlotId ?? null : null,
  };
}

/** A Google Maps directions link: to the grave's pin, else to the cemetery. */
export function directionsUrl(g: Pick<PublicGrave, 'lat' | 'lng' | 'cemeteryLat' | 'cemeteryLng' | 'cemeteryName' | 'cemeteryAddress'>): string | null {
  const lat = g.lat ?? g.cemeteryLat;
  const lng = g.lng ?? g.cemeteryLng;
  if (lat !== null && lng !== null) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const q = [g.cemeteryName, g.cemeteryAddress].filter(Boolean).join(', ');
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}
