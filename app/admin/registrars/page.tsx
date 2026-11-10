'use client';
// Super admin: cemetery registrars and families' reports on burial-register
// entries. Registrars sign themselves up (no approval queue), so this page
// is only for the rare problem: remove a bad registrar, or act on a report.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import { graveLabel } from '@/lib/grave-match';
import ButtonLink from '@/components/ButtonLink';
import { PageSkeleton } from '@/components/Skeleton';
import type { GraveBurial, UserProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Registrar = { uid: string; email: string; placeId: string; cemeteryName: string };
type Report = {
  id: string;
  reason: string;
  reporterEmail: string | null;
  placeId: string;
  cemeteryName: string;
  grave: {
    id: string;
    section: string;
    row: string;
    plotNumber: string;
    burials: GraveBurial[];
    status: string;
  } | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data as T;
}

export default function AdminRegistrars() {
  const router = useRouter();
  const [access, setAccess] = useState<'checking' | 'ok' | 'denied'>('checking');
  const [registrars, setRegistrars] = useState<Registrar[] | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        if (!u) return router.push('/auth');
        const snap = await getDoc(doc(db, 'users', u.uid));
        setAccess(isSuperAdmin(snap.exists() ? (snap.data() as UserProfile) : null) ? 'ok' : 'denied');
      }),
    [router],
  );

  const load = useCallback(async () => {
    try {
      const data = await api<{ registrars: Registrar[]; reports: Report[] }>('/api/admin/registrars');
      setRegistrars(data.registrars);
      setReports(data.reports);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (access === 'ok') load();
  }, [access, load]);

  const byCemetery = useMemo(() => {
    const map = new Map<string, { name: string; people: Registrar[] }>();
    for (const r of registrars || []) {
      if (!map.has(r.placeId)) map.set(r.placeId, { name: r.cemeteryName, people: [] });
      map.get(r.placeId)!.people.push(r);
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [registrars]);

  async function removeRegistrar(r: Registrar) {
    if (!confirm(`Remove ${r.email} as a registrar of ${r.cemeteryName}?`)) return;
    setBusy(`${r.placeId}:${r.uid}`);
    try {
      await api('/api/registrar/remove', { method: 'POST', body: JSON.stringify({ placeId: r.placeId, uid: r.uid }) });
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function decide(reportId: string, action: 'dismiss' | 'delete_grave') {
    if (action === 'delete_grave' && !confirm('Delete this grave from the register?')) return;
    setBusy(reportId);
    try {
      await api('/api/admin/registrars', { method: 'POST', body: JSON.stringify({ reportId, action }) });
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (access === 'checking') return <PageSkeleton variant="default" label="Loading" />;
  if (access === 'denied') {
    return (
      <main className="shell">
        <p>Not authorized.</p>
      </main>
    );
  }

  return (
    <main className="shell">
      <div style={{ marginBottom: 14 }}>
        <ButtonLink href="/admin" className="button secondary small">Admin</ButtonLink>
      </div>
      <div className="eyebrow">Admin</div>
      <h1>Cemetery registrars</h1>
      <p className="muted">
        Registrars sign themselves up: the first person for a cemetery gets in, then they add
        others. You only need this page when something is reported.
      </p>
      {error && <p style={{ color: '#a94442' }}>{error}</p>}

      <h2 style={{ marginTop: 30 }}>Reported register entries ({reports.length})</h2>
      {reports.length === 0 && <p className="muted">Nothing reported.</p>}
      {reports.map((r) => (
        <div key={r.id} className="card" style={{ marginBottom: 12 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            {r.cemeteryName}
            {r.grave && graveLabel(r.grave) ? ` · ${graveLabel(r.grave)}` : ''}
            {r.reporterEmail ? ` · reported by ${r.reporterEmail}` : ''}
          </div>
          {r.grave ? (
            <div style={{ fontWeight: 600 }}>
              {r.grave.burials.map((b) => [b.forenames, b.surname].filter(Boolean).join(' ') + (b.died ? ` (${b.died})` : '')).join('; ')}
              {r.grave.status === 'adopted' && <span className="muted"> · adopted by a family</span>}
            </div>
          ) : (
            <div className="muted">Grave already removed.</div>
          )}
          <p style={{ margin: '8px 0' }}>&ldquo;{r.reason}&rdquo;</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="button secondary small" disabled={busy === r.id} onClick={() => decide(r.id, 'dismiss')}>
              Dismiss
            </button>
            {r.grave && r.grave.status !== 'adopted' && (
              <button type="button" className="button secondary small" disabled={busy === r.id} onClick={() => decide(r.id, 'delete_grave')}>
                Delete the grave
              </button>
            )}
            <Link href={`/cemetery/${r.placeId}/registrar`} className="button secondary small">
              Open the register
            </Link>
          </div>
        </div>
      ))}

      <h2 style={{ marginTop: 30 }}>Registrars</h2>
      {registrars === null && <p className="muted">Loading…</p>}
      {registrars && registrars.length === 0 && <p className="muted">No registrars yet.</p>}
      {byCemetery.map(([placeId, c]) => (
        <div key={placeId} className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>
            <Link href={`/cemetery/${placeId}/registrar`}>{c.name}</Link>
          </h3>
          {c.people.map((r) => (
            <div key={r.uid} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere' }}>{r.email || r.uid}</span>
              <button
                type="button"
                className="button secondary small"
                disabled={busy === `${r.placeId}:${r.uid}`}
                onClick={() => removeRegistrar(r)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ))}
    </main>
  );
}
