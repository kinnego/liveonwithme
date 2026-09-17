'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  doc,
  getDoc,
  collection,
  onSnapshot,
  query,
  where,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';

export const dynamic = 'force-dynamic';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
const PRICE_EUR = 199;

function ContributionPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (path) {
      setUrl(`${R2_PUBLIC_URL}/${path}`);
    }
  }, [path]);

  if (!url) return <div className="thumb" />;
  return (
    <div className="thumb">
      <img src={url} alt="Submitted" />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string; label: string }> = {
    draft: { bg: '#f0e8d8', fg: '#8b6f30', label: 'Draft' },
    awaiting_payment: { bg: '#ffe8cc', fg: '#a05a00', label: 'Awaiting payment' },
    live: { bg: '#dde5df', fg: '#2f5b48', label: 'Live' },
  };
  const c = colors[status] || colors.draft;
  return (
    <span
      style={{
        display: 'inline-block',
        borderRadius: 999,
        padding: '5px 12px',
        fontSize: 12,
        fontWeight: 750,
        background: c.bg,
        color: c.fg,
      }}
    >
      {c.label}
    </span>
  );
}

export default function Manage({ params }: { params: Promise<{ id: string }> }) {
  const [m, setM] = useState<any>();
  const [items, setItems] = useState<any[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const router = useRouter();

  useEffect(() => {
    let stop: any;
    params.then(({ id }) =>
      onAuthStateChanged(auth, async (u) => {
        if (!u) return router.push('/auth');
        const snap = await getDoc(doc(db, 'memorials', id));
        if (!snap.exists() || snap.data().ownerId !== u.uid) return router.push('/dashboard');
        setM({ id: snap.id, ...snap.data() });
        stop = onSnapshot(
          query(
            collection(db, 'contributions'),
            where('memorialId', '==', id),
            where('status', '==', 'pending')
          ),
          (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        );
      })
    );
    return () => stop?.();
  }, [params, router]);

  async function refreshMemorial() {
    if (!m) return;
    const snap = await getDoc(doc(db, 'memorials', m.id));
    if (snap.exists()) setM({ id: snap.id, ...snap.data() });
  }

  async function goLive() {
    if (!m) return;
    setPublishing(true);
    setPublishError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/memorial/go-live', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ memorialId: m.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      await refreshMemorial();
    } catch (err: any) {
      setPublishError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  async function contribStatus(id: string, value: string) {
    await updateDoc(doc(db, 'contributions', id), { status: value });
  }

  async function download(path: string, name: string) {
    const url = `${R2_PUBLIC_URL}/${path}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'memory-photo';
    a.target = '_blank';
    a.click();
  }

  if (!m) return <main className="shell">Opening family controls…</main>;

  const isDraft = m.status === 'draft';
  const isLive = m.status === 'live';
  const isAwaitingPayment = m.status === 'awaiting_payment';
  const isFuneralDirectorPaid = m.paymentStatus === 'paid_via_funeral_director';
  const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}/m/${m.slug}` : `/m/${m.slug}`;

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Family controls</div>
          <h2 style={{ marginBottom: 5 }}>{m.fullName}</h2>
          <p className="muted" style={{ margin: 0 }}>
            <StatusBadge status={m.status} />
            {isFuneralDirectorPaid && (
              <span style={{ marginLeft: 10, fontSize: 13 }}>
                · Paid via funeral director
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href={`/m/${m.slug}`} className="button secondary">
            {isLive ? 'View memorial' : 'Preview'}
          </Link>
        </div>
      </div>

      {/* Go Live section */}
      {!isLive && (
        <div
          className="card"
          style={{
            marginBottom: 30,
            background: 'linear-gradient(135deg, #fffdf9, #f0e8d8)',
            borderColor: '#e0c890',
          }}
        >
          <div className="eyebrow">Ready when you are</div>
          <h3 style={{ marginTop: 10 }}>Make {m.fullName.split(' ')[0]}'s memorial live</h3>
          {isFuneralDirectorPaid ? (
            <p className="muted">
              Your funeral director has already covered the cost. When you're ready, publish the
              memorial so family and friends can visit it and share their memories.
            </p>
          ) : (
            <p className="muted">
              Take your time building the memorial. When you're ready, going live activates the
              memorial for family and friends. A one-time fee of <strong>€{PRICE_EUR}</strong> covers
              hosting for life.
            </p>
          )}

          {publishError && (
            <p style={{ color: '#a94442', marginTop: 12, fontSize: 14 }}>{publishError}</p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <button className="button" onClick={goLive} disabled={publishing}>
              {publishing
                ? 'Working…'
                : isFuneralDirectorPaid
                  ? 'Go Live'
                  : `Go Live · €${PRICE_EUR}`}
            </button>
            <Link href={`/m/${m.slug}`} className="button secondary">
              Preview first
            </Link>
          </div>

          {isAwaitingPayment && !isFuneralDirectorPaid && (
            <p className="muted" style={{ marginTop: 15, fontSize: 13 }}>
              You started checkout but payment wasn't completed. Click Go Live to try again.
            </p>
          )}
        </div>
      )}

      {isLive && (
        <div
          className="card"
          style={{
            marginBottom: 30,
            background: 'linear-gradient(135deg, #fffdf9, #dde5df)',
            borderColor: '#a8bcae',
          }}
        >
          <div className="eyebrow">Memorial is live</div>
          <h3 style={{ marginTop: 10 }}>Share {m.fullName.split(' ')[0]}'s memorial</h3>
          <p className="muted">
            This memorial is live and accessible via the link below. Share it with family and
            friends.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <button
              className="button"
              onClick={() => navigator.clipboard.writeText(publicUrl)}
            >
              Copy memorial link
            </button>
            <Link href={`/memorial/${m.id}/qr`} className="button secondary">
              Get QR code
            </Link>
          </div>
        </div>
      )}

      {/* Existing management cards */}
      <div className="featureGrid">
        <div className="card">
          <h3>Edit their story</h3>
          <p className="muted">Name, dates, introduction, life story and privacy.</p>
          <button className="button soft">Edit memorial</button>
        </div>
        <div className="card">
          <h3>Photographs</h3>
          <p className="muted">Organise the family gallery and download originals.</p>
          <button className="button soft">Open gallery</button>
        </div>
        <div className="card">
          <h3>Invite people</h3>
          <p className="muted">Send the private link to people who knew them.</p>
          <button
            className="button soft"
            disabled={!isLive}
            onClick={() => navigator.clipboard.writeText(publicUrl)}
          >
            {isLive ? 'Copy memorial link' : 'Publish first to share'}
          </button>
        </div>
      </div>

      {isLive && (
        <section style={{ marginTop: 55 }}>
          <div className="eyebrow">Contributions inbox</div>
          <h2>Waiting for your approval</h2>
          {items.length === 0 ? (
            <div className="card">
              <p className="muted">There are no contributions waiting at the moment.</p>
            </div>
          ) : (
            items.map((c) => (
              <div className="card contribution" key={c.id} style={{ marginBottom: 12 }}>
                {c.photoPath ? (
                  <ContributionPhoto path={c.photoPath} />
                ) : (
                  <div className="thumb" />
                )}
                <div>
                  <strong>{c.contributorName}</strong>
                  {c.relationship && <span className="muted"> · {c.relationship}</span>}
                  <p>{c.memory || c.caption || 'Photograph submitted'}</p>
                </div>
                <div className="toolbar">
                  <button className="button small" onClick={() => contribStatus(c.id, 'approved')}>
                    Approve
                  </button>
                  {c.photoPath && (
                    <button
                      className="button secondary small"
                      onClick={() => download(c.photoPath, c.caption)}
                    >
                      Download
                    </button>
                  )}
                  <button
                    className="button secondary small"
                    onClick={() => contribStatus(c.id, 'rejected')}
                  >
                    Not now
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      )}
    </main>
  );
}
