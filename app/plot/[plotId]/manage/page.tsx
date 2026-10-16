'use client';

// Plot admin workspace. Everything per-grave that isn't about a single
// person's content: the optional plot label, the grave-pin editor, the
// list of memorials remembered here, and the shortcuts to plaque/QR
// generation + the public plot page. The /memorial/[id]/manage page keeps
// per-person controls; cross-linking between the two keeps the mental
// model honest — a plot is a container, a memorial is a person.

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { isPlotAdmin } from '@/lib/plot';
import type { Memorial, Plot } from '@/lib/types';
import PlotLocationEditor from '@/components/PlotLocationEditor';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type LoadState = 'loading' | 'not_found' | 'not_authorized' | 'ready';

export default function PlotManagePage({
  params,
}: {
  params: Promise<{ plotId: string }>;
}) {
  const { plotId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [plot, setPlot] = useState<Plot | null>(null);
  const [memorials, setMemorials] = useState<Memorial[] | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  // Name editor
  const [nameInput, setNameInput] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState('');
  const [nameSaved, setNameSaved] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) router.push(`/auth?next=/plot/${plotId}/manage`);
    });
  }, [plotId, router]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, 'plots', plotId),
      (snap) => {
        if (!snap.exists()) {
          setLoadState('not_found');
          return;
        }
        const p = { id: snap.id, ...(snap.data() as Omit<Plot, 'id'>) };
        if (!isPlotAdmin(p, user.uid)) {
          setLoadState('not_authorized');
          return;
        }
        setPlot(p);
        setNameInput((prev) => (prev === '' ? p.name || '' : prev));
        setLoadState('ready');
      },
      () => setLoadState('not_authorized'),
    );
  }, [user, plotId]);

  useEffect(() => {
    if (!user || loadState !== 'ready') return;
    let cancelled = false;
    (async () => {
      try {
        const memsSnap = await getDocs(
          query(
            collection(db, 'plotMemberships'),
            where('plotId', '==', plotId),
            where('status', '==', 'approved'),
          ),
        );
        if (cancelled) return;
        const results: Memorial[] = [];
        for (const mem of memsSnap.docs) {
          const memId = mem.data().memorialId as string | undefined;
          if (!memId) continue;
          try {
            const mSnap = await getDoc(doc(db, 'memorials', memId));
            if (!mSnap.exists()) continue;
            const data = mSnap.data() as Omit<Memorial, 'id'>;
            results.push({ id: mSnap.id, ...data });
          } catch {
            // Plot admins who aren't also the memorial's owner/successor/
            // co-manager can only read live-public memorials. A draft they
            // can't see still deserves a slot in the list so the admin
            // knows the plot isn't empty.
            results.push({
              id: memId,
              slug: memId,
              fullName: 'A memorial',
              status: 'draft',
              paymentStatus: 'unpaid',
              salesChannel: 'direct',
              visibility: 'public',
              ownerId: '',
            });
          }
        }
        if (!cancelled) setMemorials(results);
      } catch (err) {
        console.warn('plot manage: could not load memorials', err);
        if (!cancelled) setMemorials([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, plotId, loadState]);

  async function saveName() {
    if (!auth.currentUser) return;
    setNameBusy(true);
    setNameError('');
    setNameSaved(false);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/plot/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plotId, name: nameInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Could not save the name.');
      }
      setNameSaved(true);
      // Hide the "Saved" nudge after a few seconds.
      setTimeout(() => setNameSaved(false), 2500);
    } catch (err: any) {
      setNameError(err?.message || 'Could not save the name.');
    } finally {
      setNameBusy(false);
    }
  }

  if (user === undefined || loadState === 'loading') {
    return <PageSkeleton variant="default" label="Loading the plot" />;
  }
  if (loadState === 'not_found') {
    return (
      <main className="shell">
        <div className="formCard">
          <h2>We couldn&rsquo;t find that plot.</h2>
          <p className="muted">
            It may have been removed. If you think this is a mistake, please contact support.
          </p>
          <Link href="/dashboard" className="button secondary" style={{ marginTop: 16 }}>
            Back to your dashboard
          </Link>
        </div>
      </main>
    );
  }
  if (loadState === 'not_authorized' || !plot) {
    return (
      <main className="shell">
        <div className="formCard">
          <h2>Only the plot administrator can manage this plot.</h2>
          <p className="muted">
            If a loved one originally set this up, ask them to add you as a co-administrator.
          </p>
          <Link href="/dashboard" className="button secondary" style={{ marginTop: 16 }}>
            Back to your dashboard
          </Link>
        </div>
      </main>
    );
  }

  const cemetery = plot.cemetery;
  const nameHasChanged = (nameInput || '').trim() !== (plot.name || '');

  return (
    <main className="shell">
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div className="eyebrow">A resting place</div>
        <h2 style={{ marginBottom: 6 }}>
          {plot.name || cemetery?.name || 'This plot'}
        </h2>
        {cemetery?.name && (plot.name || cemetery?.address) && (
          <p className="muted" style={{ marginTop: 0 }}>
            {plot.name ? `${cemetery.name}` : ''}
            {plot.name && cemetery.address ? ' · ' : ''}
            {cemetery.address || ''}
          </p>
        )}

        <div className="card" style={{ marginTop: 24, marginBottom: 24 }}>
          <div className="eyebrow">The plot</div>
          <h3 style={{ marginTop: 10 }}>An optional label</h3>
          <p className="muted">
            Add a label like &ldquo;Plot 34, Row C&rdquo; or &ldquo;The Murphy family grave&rdquo; — it&rsquo;s shown at the top of the public plot page. Leave blank to use the cemetery name only.
          </p>
          <input
            id="plotName"
            value={nameInput}
            onChange={(e) => {
              setNameInput(e.target.value);
              setNameSaved(false);
              setNameError('');
            }}
            placeholder="Plot 34, Row C"
            maxLength={80}
            style={{ marginTop: 10 }}
          />
          {nameError && (
            <p style={{ color: '#a94442', marginTop: 10, fontSize: 14 }}>{nameError}</p>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="button"
              onClick={saveName}
              disabled={nameBusy || !nameHasChanged}
            >
              {nameBusy ? 'Saving…' : 'Save label'}
            </button>
            {nameSaved && (
              <span className="muted" style={{ fontSize: 13 }}>
                Saved.
              </span>
            )}
          </div>
        </div>

        {cemetery && auth.currentUser && (
          <PlotLocationEditor
            plotId={plot.id}
            cemetery={cemetery}
            actorUid={auth.currentUser.uid}
            actorEmail={auth.currentUser.email || undefined}
          />
        )}

        <div className="card" style={{ marginBottom: 24 }}>
          <div className="eyebrow">Remembered here</div>
          <h3 style={{ marginTop: 10 }}>
            {memorials && memorials.length > 0
              ? `${memorials.length} ${memorials.length === 1 ? 'person' : 'people'}`
              : 'The people on this plot'}
          </h3>
          {memorials === null ? (
            <p className="muted">Loading…</p>
          ) : memorials.length === 0 ? (
            <p className="muted">
              Nobody is linked to this plot yet. Add the first memorial below.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0 0' }}>
              {memorials.map((m) => (
                <li
                  key={m.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 0',
                    borderTop: '1px solid var(--line)',
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{m.fullName || 'A memorial'}</div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {m.status === 'live' ? 'Live' : m.status === 'awaiting_payment' ? 'Awaiting payment' : 'Draft'}
                      {m.born || m.died ? (
                        <>
                          {' · '}
                          {(m.born || '').slice(0, 4)}
                          {m.died ? ` — ${m.died.slice(0, 4)}` : ''}
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {m.status === 'live' && m.slug && (
                      <Link href={`/m/${m.slug}`} className="button secondary">
                        View
                      </Link>
                    )}
                    {m.ownerId === user?.uid && (
                      <Link href={`/memorial/${m.id}/manage`} className="button secondary">
                        Manage
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 18 }}>
            <Link
              href={`/create?plot=${encodeURIComponent(plot.id)}`}
              className="button"
            >
              Add another memorial to this plot
            </Link>
            <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
              Additional names use the reduced rate. The QR engraved on the stone stays the same — new names simply appear when scanned.
            </p>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 24 }}>
          <div className="eyebrow">For the stone</div>
          <h3 style={{ marginTop: 10 }}>Headstone artwork</h3>
          <p className="muted">
            Everything your stonemason or engraver needs — the bare QR for etching, or the full
            designed plaque for mounting. The code resolves to the plot page, which lists
            everyone remembered here.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <Link href={`/plot/${plot.id}/artwork`} className="button">
              Open artwork
            </Link>
            <Link href={`/plot/${plot.id}`} className="button secondary">
              View public plot page
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
