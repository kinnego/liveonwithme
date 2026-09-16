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

export default function Manage({ params }: { params: Promise<{ id: string }> }) {
  const [m, setM] = useState<any>();
  const [items, setItems] = useState<any[]>([]);
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

  async function status(id: string, value: string) {
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

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Family controls</div>
          <h2 style={{ marginBottom: 5 }}>{m.fullName}</h2>
          <p className="muted">
            Everything submitted by visitors stays here until you decide what to do with it.
          </p>
        </div>
        <Link href={`/m/${m.slug}`} className="button secondary">
          View memorial
        </Link>
      </div>

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
            onClick={() =>
              navigator.clipboard.writeText(`${location.origin}/m/${m.slug}`)
            }
          >
            Copy memorial link
          </button>
        </div>
      </div>

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
                <button className="button small" onClick={() => status(c.id, 'approved')}>
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
                <button className="button secondary small" onClick={() => status(c.id, 'rejected')}>
                  Not now
                </button>
              </div>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
