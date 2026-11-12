'use client';
// The registrar page for one cemetery: the parish burial register as a
// searchable list, with add / fix / pin. Anyone with a verified email can
// become the first registrar of a cemetery; after that, registrars add each
// other. No approval from us. Registrars can only change graves no family
// has adopted yet, so the worst a mistake can do is a wrong suggestion that
// a family says "no" to.

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import ButtonLink from '@/components/ButtonLink';
import { PageSkeleton } from '@/components/Skeleton';
import GraveForm, { emptyGrave, type GraveFormValue } from '@/components/GraveForm';
import RegisterSetup from '@/components/RegisterSetup';
import RegisterUpload from '@/components/RegisterUpload';
import MyGraveyards from '@/components/MyGraveyards';
import {
  BookIcon,
  CameraIcon,
  EnvelopeIcon,
  HeadstoneIcon,
  IconCircle,
  KeyboardIcon,
  OrDivider,
  PhonePinIcon,
} from '@/components/ParishIcons';
import { graveLabel } from '@/lib/grave-match';
import { loadGoogleMaps } from '@/lib/places';
import { customIdFromPlaceId, isCustomPlaceId, readCustomCemetery } from '@/lib/cemeteries';
import { SUPER_ADMIN_EMAIL, type Cemetery, type GraveBurial } from '@/lib/types';
import { GRAVEYARDS_CHANGED } from '@/components/SiteNav';

export const dynamic = 'force-dynamic';

type Grave = {
  id: string;
  section: string;
  row: string;
  plotNumber: string;
  lat: number | null;
  lng: number | null;
  burials: GraveBurial[];
  inscription: string;
  status: 'unclaimed' | 'adopted';
  adoptedPlotId: string | null;
  source: 'import' | 'registrar' | 'upload';
  uploadId: string | null;
  editedByHand: boolean;
  updatedAt: number | null;
};

type Upload = {
  id: string;
  fileName: string;
  mode: 'add_and_update' | 'add_only';
  uploadedByEmail: string | null;
  people: number;
  graves: number;
  added: number;
  updated: number;
  skipped: number;
  uncertainCells: number;
  createdAt: number | null;
};

type PinState = { busy: true } | { busy: false; accuracy: number | null; prev: { lat: number | null; lng: number | null } } | { busy: false; error: string };

type Status = {
  isRegistrar: boolean;
  isSuperAdmin: boolean;
  emailVerified: boolean;
  registrarCount: number;
  canJoin: boolean;
  cemetery: Cemetery | null;
  registrars: { uid: string; email: string }[];
};

const PAGE = 60;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data as T;
}

function sortKey(g: Grave): string {
  const pad = (s: string) => (/^\d+$/.test(s) ? s.padStart(6, '0') : s.toLowerCase());
  return [pad(g.section), pad(g.row), pad(g.plotNumber), (g.burials[0]?.surname || '').toLowerCase()].join('|');
}

function toFormValue(g: Grave): GraveFormValue {
  return {
    section: g.section,
    row: g.row,
    plotNumber: g.plotNumber,
    inscription: g.inscription,
    lat: g.lat,
    lng: g.lng,
    burials: g.burials.map((b) => ({
      forenames: b.forenames || '',
      surname: b.surname,
      died: b.died || (b.diedYear ? String(b.diedYear) : ''),
      age: b.age || '',
      nickname: b.nickname || '',
      born: b.born || '',
      address: b.address || '',
      relations: b.relations || '',
      notes: b.notes || '',
    })),
  };
}

function toPayload(v: GraveFormValue) {
  return {
    section: v.section,
    row: v.row,
    plotNumber: v.plotNumber,
    inscription: v.inscription,
    lat: v.lat,
    lng: v.lng,
    burials: v.burials.filter((b) => b.surname.trim()),
  };
}

export default function RegistrarPage({
  params,
  searchParams,
}: {
  params: Promise<{ placeId: string }>;
  searchParams: Promise<{ name?: string; address?: string; lat?: string; lng?: string }>;
}) {
  const { placeId } = use(params);
  const sp = use(searchParams);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [status, setStatus] = useState<Status | null>(null);
  const [graves, setGraves] = useState<Grave[] | null>(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMsg, setInviteMsg] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [walkMode, setWalkMode] = useState(false);
  const [pins, setPins] = useState<Record<string, PinState>>({});

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);

  // Cemetery details: from an existing registrar if there is one, otherwise
  // from the link on the cemetery page.
  // Arriving from the parishes search we may have only a name (Google) or
  // nothing at all (a community-added cemetery), so look up the rest.
  const [looked, setLooked] = useState<Cemetery | null>(null);
  const needsLookup = status !== null && !status.cemetery && (!sp.name || sp.lat === undefined);
  useEffect(() => {
    if (!needsLookup) return;
    let cancelled = false;
    (async () => {
      try {
        if (isCustomPlaceId(placeId)) {
          const c = await readCustomCemetery(customIdFromPlaceId(placeId));
          if (c && !cancelled) setLooked({ name: c.name, address: c.address || '', placeId, lat: c.lat, lng: c.lng });
          return;
        }
        const google = await loadGoogleMaps();
        const place = new google.maps.places.Place({ id: placeId });
        await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
        if (cancelled) return;
        setLooked({
          name: place.displayName || sp.name || '',
          address: place.formattedAddress || '',
          placeId,
          lat: place.location?.lat() ?? null,
          lng: place.location?.lng() ?? null,
        });
      } catch (err) {
        console.error('Cemetery lookup failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsLookup, placeId, sp.name]);

  const cemetery: Cemetery | null = useMemo(() => {
    if (status?.cemetery) return status.cemetery;
    if (looked && looked.name) return looked;
    if (!sp.name) return null;
    const lat = sp.lat !== undefined ? Number(sp.lat) : NaN;
    const lng = sp.lng !== undefined ? Number(sp.lng) : NaN;
    return {
      name: sp.name,
      address: sp.address || '',
      placeId,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    };
  }, [status, looked, sp.name, sp.address, sp.lat, sp.lng, placeId]);

  const canManage = !!status && (status.isRegistrar || status.isSuperAdmin);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api<Status>(`/api/registrar?placeId=${encodeURIComponent(placeId)}`));
    } catch (err: any) {
      setError(err.message);
    }
  }, [placeId]);

  const loadGraves = useCallback(async () => {
    try {
      const data = await api<{ graves: Grave[] }>(`/api/grave-records?placeId=${encodeURIComponent(placeId)}`);
      setGraves(data.graves.sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
    } catch (err: any) {
      setError(err.message);
    }
  }, [placeId]);

  useEffect(() => {
    if (user) loadStatus();
  }, [user, loadStatus]);

  const loadUploads = useCallback(async () => {
    try {
      const data = await api<{ uploads: Upload[] }>(`/api/grave-records/uploads?placeId=${encodeURIComponent(placeId)}`);
      setUploads(data.uploads);
    } catch {
      // History is a nice-to-have; the register still works without it.
    }
  }, [placeId]);

  useEffect(() => {
    if (canManage) {
      loadGraves();
      loadUploads();
    }
  }, [canManage, loadGraves, loadUploads]);

  const uploadName = useMemo(() => new Map(uploads.map((u) => [u.id, u.fileName])), [uploads]);

  const filtered = useMemo(() => {
    if (!graves) return [];
    const q = search.trim().toLowerCase();
    // Walking the graveyard: only graves still waiting for a pin, so the
    // list shrinks as you go.
    const base = walkMode
      ? graves.filter((g) => (g.lat === null || pins[g.id]) && g.status !== 'adopted')
      : graves;
    if (!q) return base;
    return base.filter((g) =>
      g.burials.some((b) => `${b.forenames || ''} ${b.nickname || ''} ${b.surname}`.toLowerCase().includes(q)) ||
      graveLabel(g).toLowerCase().includes(q),
    );
  }, [graves, search, walkMode, pins]);

  const stats = useMemo(() => {
    const gs = graves || [];
    return {
      graves: gs.length,
      burials: gs.reduce((n, g) => n + g.burials.length, 0),
      pinned: gs.filter((g) => g.lat !== null).length,
      adopted: gs.filter((g) => g.status === 'adopted').length,
    };
  }, [graves]);

  async function join() {
    if (!cemetery) return;
    setJoining(true);
    setError('');
    try {
      await api('/api/registrar/join', { method: 'POST', body: JSON.stringify({ cemetery }) });
      // Tell the site menu, so "My graveyard register" appears at once.
      window.dispatchEvent(new Event(GRAVEYARDS_CHANGED));
      await loadStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setJoining(false);
    }
  }

  async function saveNew(v: GraveFormValue, andNext: boolean) {
    const { grave } = await api<{ grave: Grave }>('/api/grave-records', {
      method: 'POST',
      body: JSON.stringify({ cemetery, ...toPayload(v) }),
    });
    setGraves((cur) => [...(cur || []), grave].sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
    if (!andNext) setAdding(false);
  }

  async function saveEdit(id: string, v: GraveFormValue) {
    const { grave } = await api<{ grave: Grave }>(`/api/grave-records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(toPayload(v)),
    });
    setGraves((cur) => (cur || []).map((g) => (g.id === id ? grave : g)));
    setEditingId(null);
  }

  async function remove(id: string) {
    await api(`/api/grave-records/${id}`, { method: 'DELETE' });
    setGraves((cur) => (cur || []).filter((g) => g.id !== id));
    setEditingId(null);
  }

  function pinHere(g: Grave) {
    if (!('geolocation' in navigator)) {
      setPins((p) => ({ ...p, [g.id]: { busy: false, error: 'This device can’t share its location.' } }));
      return;
    }
    setPins((p) => ({ ...p, [g.id]: { busy: true } }));
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        try {
          await api(`/api/grave-records/${g.id}/pin`, { method: 'POST', body: JSON.stringify({ lat, lng }) });
          setPins((p) => ({
            ...p,
            [g.id]: { busy: false, accuracy: Math.round(pos.coords.accuracy), prev: { lat: g.lat, lng: g.lng } },
          }));
          // Keep the grave on screen (with Undo) until the next search,
          // even though walk mode hides pinned graves.
          setGraves((cur) => (cur || []).map((x) => (x.id === g.id ? { ...x, lat, lng } : x)));
        } catch (err: any) {
          setPins((p) => ({ ...p, [g.id]: { busy: false, error: err.message } }));
        }
      },
      () =>
        setPins((p) => ({
          ...p,
          [g.id]: { busy: false, error: 'Couldn’t get your location. Check location is allowed for this site.' },
        })),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  async function undoPin(g: Grave) {
    const st = pins[g.id];
    if (!st || st.busy || !('prev' in st)) return;
    try {
      await api(`/api/grave-records/${g.id}/pin`, { method: 'POST', body: JSON.stringify(st.prev) });
      setGraves((cur) => (cur || []).map((x) => (x.id === g.id ? { ...x, ...st.prev } : x)));
      setPins((p) => {
        const next = { ...p };
        delete next[g.id];
        return next;
      });
    } catch (err: any) {
      setPins((p) => ({ ...p, [g.id]: { busy: false, error: err.message } }));
    }
  }

  async function downloadUpload(u: Upload) {
    try {
      const { fileName, text } = await api<{ fileName: string; text: string }>(`/api/grave-records/uploads/${u.id}`);
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = /\.(csv|tsv|txt)$/i.test(fileName) ? fileName : `${fileName}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function invite() {
    setInviteMsg('');
    try {
      await api('/api/registrar/invite', {
        method: 'POST',
        body: JSON.stringify({ placeId, email: inviteEmail, cemetery }),
      });
      setInviteMsg(`${inviteEmail} can now help with the register.`);
      setInviteEmail('');
      await loadStatus();
    } catch (err: any) {
      setInviteMsg(err.message);
    }
  }

  async function stepDown() {
    if (!user || !confirm('Stop being a registrar for this cemetery? The records stay.')) return;
    try {
      await api('/api/registrar/remove', { method: 'POST', body: JSON.stringify({ placeId, uid: user.uid }) });
      await loadStatus();
      setGraves(null);
    } catch (err: any) {
      setError(err.message);
    }
  }

  const cemeteryName = cemetery?.name || 'this cemetery';
  const back = (
    <div style={{ marginBottom: 14 }}>
      <ButtonLink
        href={`/cemetery/${placeId}${sp.name ? `?name=${encodeURIComponent(sp.name)}` : ''}`}
        className="button secondary small"
      >
        Back to the cemetery
      </ButtonLink>
    </div>
  );

  if (user === undefined || (user && status === null && !error)) {
    return <PageSkeleton variant="default" label="Loading" />;
  }

  if (!user) {
    const next = `/cemetery/${placeId}/registrar${typeof window !== 'undefined' ? window.location.search : ''}`;
    return (
      <main className="shell">
        {back}
        <div className="formCard">
          <div className="eyebrow">Burial register</div>
          <h2>Keep the register for {cemeteryName}</h2>
          <p className="muted">
            Parish registrars and volunteers can put the burial register online here, so families
            can find their loved one&rsquo;s grave when they make a memorial. Sign in or create a free
            account to start.
          </p>
          <ButtonLink href={`/auth?next=${encodeURIComponent(next)}`} className="button" style={{ marginTop: 12 }}>
            Sign in to continue
          </ButtonLink>
        </div>
      </main>
    );
  }

  if (!canManage) {
    return (
      <main className="shell">
        {back}
        <div className="formCard">
          <div className="eyebrow">Burial register</div>
          <h2>Look after the register for {cemeteryName}</h2>
          <p style={{ fontSize: 18, marginBottom: 6 }}>Once you&rsquo;re set up, you can:</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 18px', display: 'grid', gap: 12 }}>
            {[
              { icon: <BookIcon size={30} />, text: 'Put the names from your burial book online' },
              { icon: <PhonePinIcon size={30} />, text: 'Pin each grave on the map as you walk around' },
              { icon: <HeadstoneIcon size={30} />, text: 'Help families find where their loved ones are buried' },
            ].map((it) => (
              <li key={it.text} style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 17 }}>
                <IconCircle size={48}>{it.icon}</IconCircle>
                {it.text}
              </li>
            ))}
          </ul>
          <p className="muted" style={{ marginTop: 0 }}>It&rsquo;s free, and you can stop at any time.</p>
          {!status ? null : status.canJoin ? (
            <>
              {!cemetery && (
                <p className="muted">
                  Open this page from the cemetery&rsquo;s own page so we know which cemetery it is.
                </p>
              )}
              {status && !status.emailVerified && (
                <p className="muted">
                  You&rsquo;ll need to verify your email address first. Check your inbox for the link
                  we sent when you signed up.
                </p>
              )}
              <button
                type="button"
                className="button"
                style={{ marginTop: 8 }}
                disabled={joining || !cemetery}
                onClick={join}
              >
                {joining ? 'Setting you up…' : `Become the registrar for ${cemeteryName}`}
              </button>
            </>
          ) : (
            <p>
              <strong>{cemeteryName} already has a registrar.</strong> Ask them to add you from their
              registrar page, using the email address you signed in with.
            </p>
          )}
          {error && <p style={{ color: '#a94442', marginTop: 12, fontSize: 14 }}>{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      {back}
      <div className="eyebrow">Burial register</div>
      <h1 style={{ marginBottom: 6 }}>{cemeteryName}</h1>
      {graves && (
        <p className="muted" style={{ marginTop: 0 }}>
          {stats.burials} {stats.burials === 1 ? 'person' : 'people'} in {stats.graves}{' '}
          {stats.graves === 1 ? 'grave' : 'graves'} · {stats.pinned} pinned on the map ·{' '}
          {stats.adopted} looked after by families
        </p>
      )}

      {error && (
        <div className="card" style={{ marginBottom: 18 }}>
          <p style={{ color: '#a94442', margin: 0 }}>{error}</p>
        </div>
      )}

      {cemetery && showImport && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 30 }}>Put the names in from photos or a spreadsheet</h2>
            <button type="button" className="button secondary small" onClick={() => setShowImport(false)}>
              ← Back
            </button>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>Three short steps. Take your time: nothing is saved until the end.</p>
          <RegisterSetup placeId={placeId} cemeteryName={cemeteryName} api={api} />
          <div style={{ borderTop: '1px solid var(--line)', margin: '24px 0' }} />
          <RegisterUpload
            cemetery={cemetery}
            hasExisting={!!graves && graves.length > 0}
            api={api}
            onDone={() => {
              loadGraves();
              loadUploads();
            }}
          />
        </div>
      )}

      {cemetery && !showImport && !adding && graves && graves.length === 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 30 }}>Put the names online</h2>
          <p style={{ marginTop: 0, fontSize: 18 }}>
            <strong>Choose one way.</strong> You don&rsquo;t need to do all three.
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {[
              {
                icon: <CameraIcon size={30} />,
                title: 'From photos of the book',
                text: 'Take photos with your phone. A free app, ChatGPT, types the names into a list, and you paste that list in here. We show you how.',
                onClick: () => setShowImport(true),
              },
              {
                icon: <KeyboardIcon size={30} />,
                title: 'Type them in myself',
                text: 'One grave at a time. Only the surname is needed.',
                onClick: () => {
                  setAdding(true);
                  setEditingId(null);
                },
              },
              {
                icon: <EnvelopeIcon size={30} />,
                title: 'Ask us to help',
                text: 'Send us an email and a real person will sort it out with you.',
                href: `mailto:${SUPER_ADMIN_EMAIL}?subject=${encodeURIComponent(`Help with the ${cemeteryName} burial register`)}`,
              },
            ].map((o, i) => (
              <div key={o.title}>
                {i > 0 && <OrDivider />}
                {(() => {
                  const inner = (
                    <>
                      <IconCircle size={52}>{o.icon}</IconCircle>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 700, fontSize: 19 }}>{o.title}</span>
                        <span className="muted" style={{ display: 'block', fontSize: 16 }}>{o.text}</span>
                      </span>
                    </>
                  );
                  const style: React.CSSProperties = {
                    display: 'flex',
                    gap: 14,
                    alignItems: 'center',
                    width: '100%',
                    textAlign: 'left',
                    border: '2px solid var(--line)',
                    borderRadius: 16,
                    padding: '14px 16px',
                    background: 'white',
                    color: 'inherit',
                    font: 'inherit',
                    cursor: 'pointer',
                  };
                  return o.href ? (
                    <a href={o.href} style={style}>{inner}</a>
                  ) : (
                    <button type="button" onClick={o.onClick} style={style}>{inner}</button>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      )}

      {cemetery && adding && (
        <GraveForm
          cemetery={cemetery}
          initial={emptyGrave()}
          isNew
          onSave={saveNew}
          onCancel={() => setAdding(false)}
        />
      )}

      {!adding && !showImport && graves && graves.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
          <button
            type="button"
            className="button"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
          >
            Add a grave
          </button>
          <button
            type="button"
            className={walkMode ? 'button' : 'button secondary'}
            aria-pressed={walkMode}
            onClick={() => {
              setWalkMode(!walkMode);
              setShown(PAGE);
            }}
          >
            {walkMode ? '✓ Walking the graveyard' : '📍 Walk the graveyard'}
          </button>
          <button type="button" className="button secondary" onClick={() => setShowImport(true)}>
            Upload more names
          </button>
          <input
            type="search"
            placeholder={walkMode ? 'Type the name on the headstone' : 'Search by name or row'}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShown(PAGE);
            }}
            style={{ flex: '1 1 200px', minWidth: 0 }}
          />
        </div>
      )}

      {graves === null && <p className="muted">Loading the register…</p>}

      {walkMode && (
        <div className="card" style={{ marginBottom: 14, padding: '12px 16px' }}>
          <p style={{ margin: 0 }}>
            Stand at a headstone, type the name you see, and tap <strong>Pin here</strong>. The list only
            shows graves without a pin, so it gets shorter as you go. Not on the list?{' '}
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setEditingId(null);
              }}
              style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
            >
              Add it by hand
            </button>{' '}
            (use &ldquo;Pin where I&rsquo;m standing&rdquo; in the form).
          </p>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            Phone GPS is usually right to within 3–10 metres. If it says more than 10 m, wait a few
            seconds in the open and try again, or fix the pin on the map later with Edit.
          </p>
        </div>
      )}


      {graves && filtered.length === 0 && graves.length > 0 && (
        <p className="muted">
          {walkMode && !search
            ? 'Every grave has a pin. Well done!'
            : `No ${walkMode ? 'unpinned ' : ''}graves match “${search}”.`}
          {walkMode && search && ' It may already be pinned, or not in the register yet: add it by hand.'}
        </p>
      )}

      {cemetery &&
        filtered.slice(0, shown).map((g) =>
          editingId === g.id ? (
            <GraveForm
              key={g.id}
              cemetery={cemetery}
              initial={toFormValue(g)}
              isNew={false}
              onSave={(v) => saveEdit(g.id, v)}
              onCancel={() => setEditingId(null)}
              onDelete={() => remove(g.id)}
            />
          ) : (
            <div key={g.id} className="card" style={{ marginBottom: 10, padding: '14px 18px' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {graveLabel(g) || 'No row or plot number'}
                    {g.lat !== null && ' · 📍 pinned'}
                    {g.status === 'adopted' && ' · looked after by a family'}
                  </div>
                  {g.burials.map((b, i) => (
                    <div key={i}>
                      <span style={{ fontWeight: 600 }}>
                        {[b.forenames, b.nickname && `(${b.nickname})`, b.surname].filter(Boolean).join(' ')}
                      </span>
                      {(b.died || b.diedYear) && (
                        <span className="muted">
                          {' '}
                          · died {b.died || b.diedYear}
                          {b.age ? `, aged ${b.age}` : ''}
                        </span>
                      )}
                      {(b.relations || b.address) && (
                        <span className="muted" style={{ fontSize: 13 }}>
                          {' '}
                          · {[b.relations, b.address].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </div>
                  ))}
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {g.source === 'upload'
                      ? `From ${g.uploadId && uploadName.get(g.uploadId) ? `“${uploadName.get(g.uploadId)}”` : 'an uploaded sheet'}`
                      : g.source === 'import'
                        ? 'Imported by LiveOnWith.me'
                        : 'Added by hand'}
                    {g.editedByHand && g.source !== 'registrar' && ' · fixed by hand since'}
                  </div>
                  {(() => {
                    const st = pins[g.id];
                    if (!st || st.busy) return null;
                    if ('error' in st) return <div style={{ color: '#a94442', fontSize: 13, marginTop: 4 }}>{st.error}</div>;
                    return (
                      <div style={{ fontSize: 13, marginTop: 4 }}>
                        📍 Pinned{st.accuracy !== null ? ` (accurate to about ${st.accuracy} m)` : ''}.{' '}
                        <button
                          type="button"
                          onClick={() => undoPin(g)}
                          style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
                        >
                          Undo
                        </button>
                      </div>
                    );
                  })()}
                </div>
                {walkMode && g.status !== 'adopted' && !(pins[g.id] && !pins[g.id].busy && 'prev' in pins[g.id]) && (
                  <button
                    type="button"
                    className="button small"
                    disabled={!!pins[g.id]?.busy}
                    onClick={() => pinHere(g)}
                  >
                    {pins[g.id]?.busy ? 'Finding you…' : '📍 Pin here'}
                  </button>
                )}
                {g.status === 'adopted' ? (
                  g.adoptedPlotId && (
                    <Link href={`/plot/${g.adoptedPlotId}`} className="button secondary small">
                      View plot
                    </Link>
                  )
                ) : (
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => {
                      setEditingId(g.id);
                      setAdding(false);
                    }}
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>
          ),
        )}

      {filtered.length > shown && (
        <button type="button" className="button secondary" onClick={() => setShown(shown + PAGE)}>
          Show more ({filtered.length - shown} left)
        </button>
      )}

      {uploads.length > 0 && (
        <div className="card" style={{ marginTop: 40 }}>
          <h3 style={{ marginTop: 0 }}>Uploaded sheets</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            We keep a copy of every sheet exactly as it was uploaded, so you can download it again.
          </p>
          {uploads.map((u) => (
            <div key={u.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ flex: '1 1 240px', minWidth: 0, overflowWrap: 'anywhere' }}>
                <strong>{u.fileName}</strong>
                <span className="muted" style={{ fontSize: 13 }}>
                  {' '}
                  · {u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-IE') : ''}
                  {u.uploadedByEmail ? ` by ${u.uploadedByEmail}` : ''} · {u.people} people, {u.added} graves added
                  {u.updated ? `, ${u.updated} updated` : ''}
                </span>
              </span>
              <button type="button" className="button secondary small" onClick={() => downloadUpload(u)}>
                Download
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: uploads.length > 0 ? 18 : 40 }}>
        <h3 style={{ marginTop: 0 }}>Registrars</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Everyone here can add and fix graves for {cemeteryName}.
        </p>
        <ul style={{ paddingLeft: 18 }}>
          {status!.registrars.map((r) => (
            <li key={r.uid}>
              {r.email || 'Unknown email'}
              {r.uid === user.uid && ' (you)'}
            </li>
          ))}
        </ul>
        <label className="fieldLabel" htmlFor="invite-email">
          Add someone else (they need a LiveOnWith.me account)
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            id="invite-email"
            type="email"
            placeholder="their@email.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            style={{ flex: '1 1 200px', minWidth: 0 }}
          />
          <button type="button" className="button secondary" disabled={!inviteEmail.includes('@')} onClick={invite}>
            Add registrar
          </button>
        </div>
        {inviteMsg && <p className="muted" style={{ fontSize: 14 }}>{inviteMsg}</p>}
        {status!.isRegistrar && (
          <button type="button" className="button secondary small" style={{ marginTop: 16 }} onClick={stepDown}>
            Stop being a registrar
          </button>
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>A poster for the noticeboard</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Print a QR code for the gate or the church porch. Visitors scan it to search for anyone
          buried in {cemeteryName}: memorial pages first, then the register.
        </p>
        <ButtonLink
          href={`/cemetery/${placeId}/artwork?${new URLSearchParams({
            name: cemetery?.name || '',
            ...(cemetery?.address ? { address: cemetery.address } : {}),
          }).toString()}`}
          className="button secondary small"
        >
          Download the poster
        </ButtonLink>
      </div>

      <div style={{ marginTop: 18 }}>
        <MyGraveyards currentPlaceId={placeId} title="Your other graveyards" />
        <ButtonLink href="/parishes#start" className="button secondary small">
          + Set up another graveyard
        </ButtonLink>
      </div>
    </main>
  );
}
