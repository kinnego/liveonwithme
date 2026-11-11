'use client';
// Add or edit one grave in a cemetery's burial register. Built for a
// registrar standing in the graveyard with a phone: surname is the only
// required field, "Pin where I'm standing" uses GPS, and "Save & next"
// keeps the section and row so a whole row can be done quickly.

import { useState } from 'react';
import { PickerMap } from '@/components/PlotLocationEditor';
import type { Cemetery } from '@/lib/types';

export interface GraveFormBurial {
  forenames: string;
  surname: string;
  died: string;
  age: string;
  nickname?: string;
  born?: string;
  address?: string;
  relations?: string;
  notes?: string;
}

const EXTRA_FIELDS: { key: 'nickname' | 'born' | 'address' | 'relations' | 'notes'; label: string; placeholder: string }[] = [
  { key: 'nickname', label: 'Known as', placeholder: 'e.g. Hughie' },
  { key: 'born', label: 'Born', placeholder: 'e.g. 1931' },
  { key: 'address', label: 'Address or townland', placeholder: 'e.g. Meenacross' },
  { key: 'relations', label: 'Relations', placeholder: 'e.g. wife of John' },
  { key: 'notes', label: 'Private notes', placeholder: 'only registrars see these' },
];

export interface GraveFormValue {
  section: string;
  row: string;
  plotNumber: string;
  inscription: string;
  burials: GraveFormBurial[];
  lat: number | null;
  lng: number | null;
}

export const EMPTY_BURIAL: GraveFormBurial = { forenames: '', surname: '', died: '', age: '' };

export function emptyGrave(prev?: Pick<GraveFormValue, 'section' | 'row' | 'plotNumber'>): GraveFormValue {
  // Carry the section and row forward and bump a numeric plot number, so the
  // next grave along the row is one tap away.
  const n = prev?.plotNumber && /^\d+$/.test(prev.plotNumber) ? String(Number(prev.plotNumber) + 1) : '';
  return {
    section: prev?.section || '',
    row: prev?.row || '',
    plotNumber: n,
    inscription: '',
    burials: [{ ...EMPTY_BURIAL }],
    lat: null,
    lng: null,
  };
}

type Props = {
  cemetery: Cemetery;
  initial: GraveFormValue;
  isNew: boolean;
  onSave: (value: GraveFormValue, andNext: boolean) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
};

const inputStyle = { width: '100%' } as const;

export default function GraveForm({ cemetery, initial, isNew, onSave, onCancel, onDelete }: Props) {
  const [v, setV] = useState<GraveFormValue>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showMore, setShowMore] = useState(!!initial.inscription);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapStart, setMapStart] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [moreOpen, setMoreOpen] = useState<number[]>(() =>
    initial.burials.flatMap((b, i) => (EXTRA_FIELDS.some((f) => b[f.key]) ? [i] : [])),
  );

  const hasPin = v.lat !== null && v.lng !== null;

  function setBurial(i: number, patch: Partial<GraveFormBurial>) {
    setV((cur) => ({
      ...cur,
      burials: cur.burials.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    }));
  }

  async function pinHere() {
    setError('');
    if (!('geolocation' in navigator)) {
      setError('This device can’t share its location. Use the map instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setV((cur) => ({ ...cur, lat: p.coords.latitude, lng: p.coords.longitude }));
        setLocating(false);
      },
      () => {
        setError('Couldn’t get your location. Check location is allowed, or use the map instead.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  async function submit(andNext: boolean) {
    setError('');
    if (!v.burials.some((b) => b.surname.trim())) {
      setError('Add at least one surname.');
      return;
    }
    setBusy(true);
    try {
      await onSave(v, andNext);
      if (andNext) {
        setV(emptyGrave(v));
        setShowMore(false);
        setMapOpen(false);
      }
    } catch (err: any) {
      setError(err?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!onDelete) return;
    if (!confirm('Remove this grave from the register?')) return;
    setBusy(true);
    setError('');
    try {
      await onDelete();
    } catch (err: any) {
      setError(err?.message || 'Could not remove.');
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h3 style={{ marginTop: 0 }}>{isNew ? 'Add a grave' : 'Edit grave'}</h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        <label>
          <span className="fieldLabel">Section</span>
          <input style={inputStyle} value={v.section} onChange={(e) => setV({ ...v, section: e.target.value })} />
        </label>
        <label>
          <span className="fieldLabel">Row</span>
          <input style={inputStyle} value={v.row} onChange={(e) => setV({ ...v, row: e.target.value })} />
        </label>
        <label>
          <span className="fieldLabel">Plot no.</span>
          <input style={inputStyle} value={v.plotNumber} onChange={(e) => setV({ ...v, plotNumber: e.target.value })} />
        </label>
      </div>

      <p className="muted" style={{ fontSize: 13, margin: '16px 0 6px' }}>
        Who is buried here? Only the surname is needed.
      </p>
      {v.burials.map((b, i) => (
        <div key={i}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 8,
            marginBottom: 8,
            paddingBottom: v.burials.length > 1 ? 8 : 0,
            borderBottom: v.burials.length > 1 ? '1px solid var(--line)' : 'none',
          }}
        >
          <input
            aria-label="First names"
            placeholder="First names"
            value={b.forenames}
            onChange={(e) => setBurial(i, { forenames: e.target.value })}
          />
          <input
            aria-label="Surname"
            placeholder="Surname"
            value={b.surname}
            onChange={(e) => setBurial(i, { surname: e.target.value })}
          />
          <input
            aria-label="Died (date or year)"
            placeholder="Died, e.g. 1987"
            value={b.died}
            onChange={(e) => setBurial(i, { died: e.target.value })}
          />
          <input
            aria-label="Age"
            placeholder="Age"
            value={b.age}
            onChange={(e) => setBurial(i, { age: e.target.value })}
          />
        </div>
        {moreOpen.includes(i) ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 8,
              margin: '0 0 12px',
            }}
          >
            {EXTRA_FIELDS.map((f) => (
              <input
                key={f.key}
                aria-label={f.label}
                placeholder={f.placeholder ? `${f.label}, ${f.placeholder}` : f.label}
                value={b[f.key] || ''}
                onChange={(e) => setBurial(i, { [f.key]: e.target.value })}
              />
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMoreOpen((cur) => [...cur, i])}
            className="muted"
            style={{ background: 'none', border: 0, padding: 0, margin: '0 0 10px', fontSize: 13, textDecoration: 'underline', cursor: 'pointer', color: 'inherit' }}
          >
            + More about this person (nickname, born, townland, relations)
          </button>
        )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="button secondary small"
          onClick={() => setV({ ...v, burials: [...v.burials, { ...EMPTY_BURIAL, surname: v.burials[0]?.surname || '' }] })}
        >
          + Another person in this grave
        </button>
        {v.burials.length > 1 && (
          <button
            type="button"
            className="button secondary small"
            onClick={() => setV({ ...v, burials: v.burials.slice(0, -1) })}
          >
            Remove last person
          </button>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <span className="fieldLabel">Location of the grave (optional)</span>
        {hasPin ? (
          <p className="muted" style={{ fontSize: 13, margin: '4px 0 8px' }}>
            Pinned at {v.lat!.toFixed(5)}, {v.lng!.toFixed(5)}
          </p>
        ) : (
          <p className="muted" style={{ fontSize: 13, margin: '4px 0 8px' }}>
            Standing at the grave? Tap below. Phone GPS is good to a few metres, so check it on the map.
          </p>
        )}
        {!mapOpen && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="button secondary small" onClick={pinHere} disabled={locating}>
              {locating ? 'Finding you…' : 'Pin where I’m standing'}
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() => {
                setMapStart(hasPin ? { lat: v.lat!, lng: v.lng! } : null);
                setMapOpen(true);
              }}
            >
              {hasPin ? 'Adjust on the map' : 'Place on the map'}
            </button>
            {hasPin && (
              <button
                type="button"
                className="button secondary small"
                onClick={() => setV({ ...v, lat: null, lng: null })}
              >
                Remove pin
              </button>
            )}
          </div>
        )}
        {mapOpen && (
          <PickerMap
            cemetery={cemetery}
            startCoords={mapStart}
            saving={false}
            saveLabel="Use this spot"
            onSave={(c) => {
              setV((cur) => ({ ...cur, lat: c.lat, lng: c.lng }));
              setMapOpen(false);
            }}
            onCancel={() => setMapOpen(false)}
          />
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        {showMore ? (
          <label>
            <span className="fieldLabel">Headstone inscription (optional)</span>
            <textarea
              rows={3}
              style={inputStyle}
              value={v.inscription}
              onChange={(e) => setV({ ...v, inscription: e.target.value })}
            />
          </label>
        ) : (
          <button type="button" className="button secondary small" onClick={() => setShowMore(true)}>
            + Headstone inscription
          </button>
        )}
      </div>

      {error && <p style={{ color: '#a94442', marginTop: 12, fontSize: 14 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {isNew && (
          <button type="button" className="button" disabled={busy} onClick={() => submit(true)}>
            {busy ? 'Saving…' : 'Save & add next'}
          </button>
        )}
        <button
          type="button"
          className={isNew ? 'button secondary' : 'button'}
          disabled={busy}
          onClick={() => submit(false)}
        >
          {isNew ? 'Save & close' : busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {onDelete && (
          <button type="button" className="button secondary" disabled={busy} onClick={remove} style={{ marginLeft: 'auto' }}>
            Remove grave
          </button>
        )}
      </div>
    </div>
  );
}
