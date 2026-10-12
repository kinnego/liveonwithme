'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import { Memorial, UserProfile } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type Access = 'checking' | 'ok' | 'denied';
type SearchStatus = 'idle' | 'searching' | 'error';

export default function AdminMemorials() {
  const [access, setAccess] = useState<Access>('checking');
  const [memorials, setMemorials] = useState<Memorial[]>([]);
  const [filter, setFilter] = useState('');
  const [serverMatches, setServerMatches] = useState<Memorial[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
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

  // Server-side search: once the filter has ≥2 chars, run a name-prefix
  // query plus an exact id/slug lookup. Super admin's firestore rules allow
  // list/get on any memorial doc, so this reaches past the latest-500 window
  // that the default load is capped to. Debounced to avoid hammering
  // Firestore on every keystroke.
  useEffect(() => {
    const needle = filter.trim().toLowerCase();
    if (needle.length < 2) {
      setServerMatches([]);
      setSearchStatus('idle');
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      setSearchStatus('searching');
      try {
        const nameSnap = await getDocs(
          query(
            collection(db, 'memorials'),
            where('fullNameLower', '>=', needle),
            where('fullNameLower', '<=', needle + '\uf8ff'),
            orderBy('fullNameLower'),
            limit(50),
          ),
        );
        const byName = nameSnap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as any) }) as Memorial,
        );

        // Exact doc-id lookup — handles slug/id searches cleanly. getDoc
        // on a missing doc just returns .exists === false, no throw.
        const direct = await getDoc(doc(db, 'memorials', needle));
        const byId = direct.exists()
          ? [{ id: direct.id, ...(direct.data() as any) } as Memorial]
          : [];

        if (cancelled) return;
        const seen = new Set<string>();
        const merged: Memorial[] = [];
        for (const m of [...byId, ...byName]) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          merged.push(m);
        }
        setServerMatches(merged);
        setSearchStatus('idle');
      } catch (err) {
        if (cancelled) return;
        console.warn('admin memorial search failed', err);
        setServerMatches([]);
        setSearchStatus('error');
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [filter]);

  const needle = filter.trim().toLowerCase();
  // Union of the latest-500 window (filtered client-side so slug / owner UID
  // searches still work) with the server-side name/id matches. The server
  // query reaches older records that aren't in the preloaded window; the
  // client filter covers fields the server index can't ('ownerId').
  const filtered = useMemo(() => {
    const localMatches = memorials.filter((m) => {
      if (!needle) return true;
      return (
        m.fullName?.toLowerCase().includes(needle) ||
        m.slug?.toLowerCase().includes(needle) ||
        m.id?.toLowerCase().includes(needle) ||
        m.ownerId?.toLowerCase().includes(needle)
      );
    });
    if (!needle) return localMatches;
    const seen = new Set<string>();
    const merged: Memorial[] = [];
    for (const m of [...localMatches, ...serverMatches]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      merged.push(m);
    }
    return merged;
  }, [memorials, serverMatches, needle]);

  if (access === 'checking') return <PageSkeleton variant="detail" label="Checking access" />;
  if (access === 'denied')
    return (
      <main className="shell">
        <div className="card">This area is for site administrators.</div>
      </main>
    );

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Admin · memorials</div>
          <h2 style={{ marginBottom: 0 }}>Memorials & plots</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {needle
              ? searchStatus === 'searching'
                ? 'Searching all memorials…'
                : `${filtered.length} match${filtered.length === 1 ? '' : 'es'} across all memorials.`
              : 'Showing the latest 500. Type to search across every memorial.'}
          </p>
        </div>
        <Link href="/admin" className="button secondary">
          Back to console
        </Link>
      </div>

      <input
        type="search"
        placeholder="Search by name, slug, id or owner UID"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 20 }}
      />
      {searchStatus === 'error' && (
        <p className="muted" style={{ color: '#a94442', margin: '-8px 0 20px', fontSize: 13 }}>
          Search ran into a snag. Try a different query, or reload the page.
        </p>
      )}

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
                    <Link href={`/admin/memorials/${m.id}`}>inspect</Link>
                    {' · '}
                    <Link href={`/m/${m.slug}`} target="_blank" rel="noopener">public ↗</Link>
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
