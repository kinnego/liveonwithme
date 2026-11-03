'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import type { UserProfile } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';

interface Orphan {
  id: string;
  fullName: string;
  pendingDeletionAt: string | null;
  pendingDeletionReason: string | null;
  heroPhotoPath: string | null;
  heroPhotoVariants: boolean;
}

export default function OrphansPage() {
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking');
  const [orphans, setOrphans] = useState<Orphan[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const router = useRouter();

  const load = useCallback(async () => {
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch('/api/admin/orphans/list', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to load orphans');
      setOrphans([]);
      return;
    }
    setOrphans(data.orphans);
  }, []);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return router.push('/auth');
      const snap = await getDoc(doc(db, 'users', u.uid));
      const prof = snap.exists() ? (snap.data() as UserProfile) : null;
      if (!isSuperAdmin(prof)) {
        setState('denied');
        return;
      }
      setState('ok');
      await load();
    });
  }, [router, load]);

  async function act(id: string, action: 'delete' | 'snooze') {
    const o = orphans?.find((x) => x.id === id);
    if (!o) return;
    if (action === 'delete') {
      const ok = window.confirm(
        `Hard-delete "${o.fullName}" and every contribution + R2 object linked to it? This cannot be undone.`,
      );
      if (!ok) return;
    }
    setBusyId(id);
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/admin/orphans/${id}/${action}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${action} failed`);
      await load();
    } catch (err: any) {
      setError(err.message || `${action} failed`);
    } finally {
      setBusyId(null);
    }
  }

  if (state === 'checking') return <PageSkeleton variant="default" label="Checking access" />;
  if (state === 'denied') {
    return (
      <main className="shell">
        <div className="card">
          <h3>This area is for site administrators.</h3>
        </div>
      </main>
    );
  }

  const dueNow = (iso: string | null) => (iso ? new Date(iso).getTime() <= Date.now() : false);

  return (
    <main className="shell">
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin" style={{ color: 'var(--muted)' }}>
          ← Admin
        </Link>
      </div>
      <div className="eyebrow">Admin</div>
      <h2 style={{ marginTop: 6 }}>Orphaned memorials</h2>
      <p className="muted" style={{ maxWidth: 640 }}>
        A memorial lands here when its owner deleted their account with no successor and no
        co-manager to promote. It&rsquo;s kept offline for 30 days so a family member can still
        reach us before anything is destroyed. Once the grace window closes, review each one and
        either delete it permanently or push the review date out.
      </p>

      {error && (
        <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{error}</p>
      )}

      {orphans === null ? (
        <p className="muted">Loading…</p>
      ) : orphans.length === 0 ? (
        <p className="muted" style={{ marginTop: 24 }}>No orphaned memorials. 🎉</p>
      ) : (
        <div style={{ marginTop: 20, display: 'grid', gap: 14 }}>
          {orphans.map((o) => {
            const due = dueNow(o.pendingDeletionAt);
            const dateLabel = o.pendingDeletionAt
              ? new Date(o.pendingDeletionAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
              : '—';
            const heroUrl = o.heroPhotoPath
              ? o.heroPhotoVariants
                ? `${R2_PUBLIC_URL}/${o.heroPhotoPath}.400.webp`
                : `${R2_PUBLIC_URL}/${o.heroPhotoPath}`
              : null;
            return (
              <div
                key={o.id}
                style={{
                  background: 'var(--paper)',
                  border: '1px solid var(--line)',
                  borderRadius: 16,
                  padding: 16,
                  display: 'grid',
                  gridTemplateColumns: '80px 1fr auto',
                  gap: 16,
                  alignItems: 'center',
                }}
              >
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 12,
                    overflow: 'hidden',
                    background: '#dde5df',
                  }}
                >
                  {heroUrl && (
                    <img
                      src={heroUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                </div>
                <div>
                  <div style={{ fontWeight: 650, fontSize: 16 }}>{o.fullName}</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                    Review date: <strong>{dateLabel}</strong>
                    {due ? ' · due now' : ' · not yet due'}
                    {o.pendingDeletionReason ? ` · ${o.pendingDeletionReason}` : ''}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    <code>{o.id}</code>
                  </div>
                </div>
                <div className="toolbar">
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={busyId === o.id}
                    onClick={() => act(o.id, 'snooze')}
                  >
                    Snooze 30d
                  </button>
                  <button
                    type="button"
                    className="button small"
                    disabled={busyId === o.id || !due}
                    onClick={() => act(o.id, 'delete')}
                    title={due ? '' : 'Grace window has not expired yet'}
                    style={!due ? { opacity: 0.5 } : undefined}
                  >
                    {busyId === o.id ? 'Working…' : 'Delete'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
