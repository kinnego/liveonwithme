'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import { Memorial, UserProfile } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type Access = 'checking' | 'ok' | 'denied';

export default function AdminMemorials() {
  const [access, setAccess] = useState<Access>('checking');
  const [memorials, setMemorials] = useState<Memorial[]>([]);
  const [filter, setFilter] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return router.push('/auth');
      const snap = await getDoc(doc(db, 'users', u.uid));
      const prof = snap.exists() ? (snap.data() as UserProfile) : null;
      if (!isSuperAdmin(prof)) {
        setAccess('denied');
        return;
      }
      setAccess('ok');
      const q = await getDocs(
        query(collection(db, 'memorials'), orderBy('createdAt', 'desc'), limit(500))
      );
      setMemorials(q.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
  }, [router]);

  if (access === 'checking') return <PageSkeleton variant="detail" label="Checking access" />;
  if (access === 'denied')
    return (
      <main className="shell">
        <div className="card">This area is for site administrators.</div>
      </main>
    );

  const filtered = memorials.filter((m) => {
    if (!filter.trim()) return true;
    const f = filter.trim().toLowerCase();
    return (
      m.fullName?.toLowerCase().includes(f) ||
      m.slug?.toLowerCase().includes(f) ||
      m.id?.toLowerCase().includes(f) ||
      m.ownerId?.toLowerCase().includes(f)
    );
  });

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Admin · memorials</div>
          <h2 style={{ marginBottom: 0 }}>Memorials & plots</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>Latest 500 memorials.</p>
        </div>
        <Link href="/admin" className="button secondary">
          Back to console
        </Link>
      </div>

      <input
        type="search"
        placeholder="Filter by name, slug, id or owner UID"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 20 }}
      />

      {filtered.length === 0 ? (
        <div className="card">
          <p className="muted">No memorials match.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
            <thead>
              <tr style={{ background: '#fffdf9', borderBottom: '1px solid var(--line)' }}>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Payment</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Channel</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Plot</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Links</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <div>{m.fullName}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{m.slug}</div>
                  </td>
                  <td style={{ padding: '10px 14px' }}>{m.status}</td>
                  <td style={{ padding: '10px 14px' }}>{m.paymentStatus}</td>
                  <td style={{ padding: '10px 14px' }}>{m.salesChannel}</td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                    {m.plotId ? (
                      <Link href={`/plot/${m.plotId}`}>{m.plotId.slice(0, 8)}…</Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                    <Link href={`/m/${m.slug}`} target="_blank">public</Link>
                    {' · '}
                    <Link href={`/memorial/${m.id}/manage`} target="_blank">manage</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
