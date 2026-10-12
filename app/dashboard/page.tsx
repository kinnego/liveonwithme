'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged, signOut } from 'firebase/auth';
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
  const [coManaging, setCoManaging] = useState<any[]>([]);
  const [userEmail, setUserEmail] = useState<string>('');
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const router = useRouter();

  useEffect(() => {
    let stopOwned: (() => void) | undefined;
    let stopNominated: (() => void) | undefined;
    let stopCoManaging: (() => void) | undefined;
    const teardownListeners = () => {
      stopOwned?.();
      stopNominated?.();
      stopCoManaging?.();
      stopOwned = undefined;
      stopNominated = undefined;
      stopCoManaging = undefined;
    };
    const stopAuth = onAuthStateChanged(auth, (u) => {
      // Always tear down first: on signout the old listeners would re-evaluate
      // with no auth and throw permission-denied; on user swap they'd leak.
      teardownListeners();
      if (!u) {
        setOwned([]);
        setNominated([]);
        setCoManaging([]);
        setUserEmail('');
        router.push('/auth');
        return;
      }
      setUserEmail((u.email || '').toLowerCase());
      stopOwned = onSnapshot(
        query(collection(db, 'memorials'), where('ownerId', '==', u.uid)),
        (s) => setOwned(s.docs.map((d) => ({ id: d.id, ...d.data() })))
      );
      stopNominated = onSnapshot(
        query(collection(db, 'memorials'), where('successorUids', 'array-contains', u.uid)),
        (s) => setNominated(s.docs.map((d) => ({ id: d.id, ...d.data() })))
      );
      // Soft-fail: before the firestore.rules update is deployed, this query
      // returns permission-denied. Treat that as "no co-managed memorials yet"
      // instead of surfacing a loud console error.
      stopCoManaging = onSnapshot(
        query(collection(db, 'memorials'), where('coManagerUids', 'array-contains', u.uid)),
        (s) => setCoManaging(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        () => setCoManaging([])
      );
    });
    return () => {
      stopAuth();
      teardownListeners();
    };
  }, [router]);

  async function handleDelete() {
    if (!auth.currentUser) return;
    const typed = deleteInput.trim().toLowerCase();
    if (typed !== userEmail) {
      setDeleteError('That doesn\u2019t match the email on your account.');
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ confirmEmail: typed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Could not delete the account.');
      }
      // Clear local auth state. The Auth user is already gone on the server,
      // but the SDK still holds a stale refresh token until signOut runs.
      await signOut(auth);
      router.push('/auth?deleted=1');
    } catch (err: any) {
      setDeleteError(err?.message || 'Something went wrong.');
      setDeleting(false);
    }
  }

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Your keeper space</div>
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

      {coManaging.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <div className="eyebrow">Helping manage</div>
          <h3 style={{ marginTop: 6 }}>Memorials you co-manage</h3>
          <p className="muted" style={{ marginBottom: 20 }}>
            You can add photos, approve memories, and edit the story alongside the owner.
          </p>
          <div className="featureGrid">
            {coManaging.map((m) => (
              <Link href={`/memorial/${m.id}/manage`} className="card" key={m.id}>
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
        </section>
      )}

      {nominated.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <div className="eyebrow">Looked after by others</div>
          <h3 style={{ marginTop: 6 }}>You&rsquo;re a backup for these memorials</h3>
          <p className="muted" style={{ marginBottom: 20 }}>
            You don&rsquo;t need to do anything today. This is just so you know they&rsquo;ll come
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

      {/* Account controls. Deliberately quiet — a right-to-erasure path
          exists for anyone who wants it, but it isn't a prominent option. */}
      {userEmail && (
        <details style={{ marginTop: 72, color: '#8c948f', fontSize: 13 }}>
          <summary style={{ cursor: 'pointer', listStyle: 'none', outline: 'none' }}>
            Account
          </summary>
          <div style={{ marginTop: 18, paddingLeft: 2, maxWidth: 520 }}>
            <p style={{ lineHeight: 1.6, margin: '0 0 14px' }}>
              If you&rsquo;d like to close your account, type your email below and we&rsquo;ll
              remove your sign-in and your profile. Memorials you look after will pass
              to anyone you&rsquo;ve nominated. Any without a nominee will be taken
              offline and held for 30 days before being removed, in case you change
              your mind.
            </p>
            <input
              type="email"
              value={deleteInput}
              onChange={(e) => {
                setDeleteInput(e.target.value);
                setDeleteError('');
              }}
              placeholder="your@email"
              aria-label="Confirm your email"
              style={{
                width: '100%',
                maxWidth: 320,
                padding: '8px 10px',
                border: '1px solid #d6d2cb',
                borderRadius: 8,
                fontFamily: 'inherit',
                fontSize: 13,
                background: '#fffdf9',
              }}
            />
            {deleteError && (
              <p style={{ color: '#a94442', margin: '10px 0 0', fontSize: 12 }}>
                {deleteError}
              </p>
            )}
            <button
              onClick={handleDelete}
              disabled={deleting || deleteInput.trim().toLowerCase() !== userEmail}
              style={{
                display: 'inline-block',
                marginTop: 14,
                padding: '8px 14px',
                border: '1px solid #c7c2b9',
                borderRadius: 999,
                background: 'transparent',
                color: '#6d7772',
                fontFamily: 'inherit',
                fontSize: 12,
                cursor:
                  deleting || deleteInput.trim().toLowerCase() !== userEmail
                    ? 'not-allowed'
                    : 'pointer',
                opacity:
                  deleting || deleteInput.trim().toLowerCase() !== userEmail
                    ? 0.5
                    : 1,
              }}
            >
              {deleting ? 'Removing\u2026' : 'Delete my account'}
            </button>
          </div>
        </details>
      )}
    </main>
  );
}
