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
import { graveLabel } from '@/lib/grave-match';
import { SUPER_ADMIN_EMAIL, type Cemetery, type GraveBurial } from '@/lib/types';

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
  source: 'import' | 'registrar';
  updatedAt: number | null;
};

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

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);

  // Cemetery details: from an existing registrar if there is one, otherwise
  // from the link on the cemetery page.
  const cemetery: Cemetery | null = useMemo(() => {
    if (status?.cemetery) return status.cemetery;
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
  }, [status, sp.name, sp.address, sp.lat, sp.lng, placeId]);

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

  useEffect(() => {
    if (canManage) loadGraves();
  }, [canManage, loadGraves]);

  const filtered = useMemo(() => {
    if (!graves) return [];
    const q = search.trim().toLowerCase();
    if (!q) return graves;
    return graves.filter((g) =>
      g.burials.some((b) => `${b.forenames || ''} ${b.surname}`.toLowerCase().includes(q)) ||
      graveLabel(g).toLowerCase().includes(q),
    );
  }, [graves, search]);

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
          <h2>Keep the register for {cemeteryName}</h2>
          <p className="muted">
            As a registrar you can add the people buried here, fix mistakes and pin graves on the
            map. When a family makes a memorial and picks this cemetery, we&rsquo;ll ask them
            &ldquo;Could this be the grave?&rdquo; so they don&rsquo;t have to find it again. Nothing
            is ever linked without the family saying yes.
          </p>
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

      {cemetery && adding && (
        <GraveForm
          cemetery={cemetery}
          initial={emptyGrave()}
          isNew
          onSave={saveNew}
          onCancel={() => setAdding(false)}
        />
      )}

      {!adding && (
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
          <input
            type="search"
            placeholder="Search by name or row"
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

      {graves && graves.length === 0 && !adding && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 style={{ marginTop: 0 }}>The register is empty</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            Add graves one at a time with the button above. If you have the register as a
            spreadsheet, or photos of the register book, email{' '}
            <a href={`mailto:${SUPER_ADMIN_EMAIL}`}>{SUPER_ADMIN_EMAIL}</a> and we&rsquo;ll load
            it in for you.
          </p>
        </div>
      )}

      {graves && filtered.length === 0 && graves.length > 0 && (
        <p className="muted">No graves match &ldquo;{search}&rdquo;.</p>
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
                    <div key={i} style={{ fontWeight: 600 }}>
                      {[b.forenames, b.surname].filter(Boolean).join(' ')}
                      {(b.died || b.diedYear) && (
                        <span className="muted" style={{ fontWeight: 400 }}>
                          {' '}
                          · died {b.died || b.diedYear}
                          {b.age ? `, aged ${b.age}` : ''}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
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

      <div className="card" style={{ marginTop: 40 }}>
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
    </main>
  );
}
