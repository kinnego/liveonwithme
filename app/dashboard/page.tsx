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
  const [items, setItems] = useState<any[]>([]);
  const router = useRouter();

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        if (!u) return router.push('/auth');
        return onSnapshot(
          query(collection(db, 'memorials'), where('ownerId', '==', u.uid)),
          (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        );
      }),
    [router]
  );

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Your family space</div>
          <h2 style={{ marginBottom: 0 }}>Memorials</h2>
        </div>
        <Link href="/create" className="button">
          Create a memorial
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="card">
          <h3>No memorials yet</h3>
          <p className="muted">
            When you're ready, create a peaceful space for someone you love.
          </p>
        </div>
      ) : (
        <div className="featureGrid">
          {items.map((m) => (
            <Link
              href={`/memorial/${m.id}/manage`}
              className="card"
              key={m.id}
            >
              <StatusBadge status={m.status} />
              <h3 style={{ marginTop: 18 }}>{m.fullName}</h3>
              <p className="muted">
                {m.born?.slice(0, 4)} — {m.died?.slice(0, 4)}
              </p>
              <span>Manage memorial →</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
