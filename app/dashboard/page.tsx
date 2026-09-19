'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

export const dynamic = 'force-dynamic';

function StatusBadge({ status }: { status?: string }) {
  const colors: Record<string, { bg: string; fg: string; label: string }> = {
    draft: { bg: '#f0e8d8', fg: '#8b6f30', label: 'Draft' },
    awaiting_payment: { bg: '#ffe8cc', fg: '#a05a00', label: 'Awaiting payment' },
    live: { bg: '#dde5df', fg: '#2f5b48', label: 'Live' },
  };
  const c = colors[status || 'draft'] || colors.draft;
  return (
    <span
      style={{
        display: 'inline-block',
        borderRadius: 999,
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: 750,
        background: c.bg,
        color: c.fg,
      }}
    >
      {c.label}
    </span>
  );
}

export default function Dashboard() {
  const [owned, setOwned] = useState<any[]>([]);
  const [nominated, setNominated] = useState<any[]>([]);
  const router = useRouter();

  useEffect(() => {
    let stopOwned: (() => void) | undefined;
    let stopNominated: (() => void) | undefined;
    const teardownListeners = () => {
      stopOwned?.();
      stopNominated?.();
      stopOwned = undefined;
      stopNominated = undefined;
    };
    const stopAuth = onAuthStateChanged(auth, (u) => {
      // Always tear down first: on signout the old listeners would re-evaluate
      // with no auth and throw permission-denied; on user swap they'd leak.
      teardownListeners();
      if (!u) {
        setOwned([]);
        setNominated([]);
        router.push('/auth');
        return;
      }
      stopOwned = onSnapshot(
        query(collection(db, 'memorials'), where('ownerId', '==', u.uid)),
        (s) => setOwned(s.docs.map((d) => ({ id: d.id, ...d.data() })))
      );
      stopNominated = onSnapshot(
        query(collection(db, 'memorials'), where('successorUids', 'array-contains', u.uid)),
        (s) => setNominated(s.docs.map((d) => ({ id: d.id, ...d.data() })))
      );
    });
    return () => {
      stopAuth();
      teardownListeners();
    };
  }, [router]);

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Your family space</div>
          <h2 style={{ marginBottom: 0 }}>Memorials</h2>
        </div>
        <Link href="/create" className="button">
          Create a page
        </Link>
      </div>
      {owned.length === 0 ? (
        <div className="card">
          <h3>No memorials yet</h3>
          <p className="muted">
            When you&rsquo;re ready, create a peaceful space for someone you love.
            If you&rsquo;re looking after a memorial someone else created, you&rsquo;ll find it
            below once you accept the invitation.
          </p>
        </div>
      ) : (
        <div className="featureGrid">
          {owned.map((m) => (
            <Link
              href={`/memorial/${m.id}/manage`}
              className="card"
              key={m.id}
            >
              <StatusBadge status={m.status} />
              <h3 style={{ marginTop: 18 }}>{m.fullName}</h3>
              <p className="muted">
                {m.kind === 'legacy'
                  ? m.born?.slice(0, 4) || 'A legacy page'
                  : `${m.born?.slice(0, 4) || ''}${m.died ? ` — ${m.died.slice(0, 4)}` : ''}`}
              </p>
              <span>Manage {m.kind === 'legacy' ? 'page' : 'memorial'} →</span>
            </Link>
          ))}
        </div>
      )}

      {nominated.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <div className="eyebrow">Looked after by others</div>
          <h3 style={{ marginTop: 6 }}>You&rsquo;re a backup for these memorials</h3>
          <p className="muted" style={{ marginBottom: 20 }}>
            You don&rsquo;t need to do anything today — this is just so you know they&rsquo;ll come
            to you if the current custodian is ever unable to look after them.
          </p>
          <div className="featureGrid">
            {nominated.map((m) => (
              <Link href={`/m/${m.slug}`} className="card" key={m.id}>
                <h3 style={{ marginTop: 0 }}>{m.fullName}</h3>
                <p className="muted">
                  {m.kind === 'legacy'
                    ? m.born?.slice(0, 4) || 'A legacy page'
                    : `${m.born?.slice(0, 4) || ''}${m.died ? ` — ${m.died.slice(0, 4)}` : ''}`}
                </p>
                <span>View {m.kind === 'legacy' ? 'page' : 'memorial'} →</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
