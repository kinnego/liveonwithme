'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import { AuditEvent, UserProfile } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type Access = 'checking' | 'ok' | 'denied';

function ts(v: any): string {
  if (!v) return '—';
  try {
    const d = v.toDate ? v.toDate() : new Date(v);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  } catch {
    return String(v);
  }
}

export default function AdminAudit() {
  const [access, setAccess] = useState<Access>('checking');
  const [events, setEvents] = useState<AuditEvent[]>([]);
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
      const stop = onSnapshot(
        query(collection(db, 'auditEvents'), orderBy('timestamp', 'desc'), limit(200)),
        (s) => setEvents(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
      );
      return () => stop();
    });
  }, [router]);

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
          <div className="eyebrow">Admin · audit</div>
          <h2 style={{ marginBottom: 0 }}>Recent activity</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>Last 200 events, newest first.</p>
        </div>
        <Link href="/admin" className="button secondary">
          Back to console
        </Link>
      </div>

      {events.length === 0 ? (
        <div className="card">
          <p className="muted">No events recorded yet.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fffdf9', borderBottom: '1px solid var(--line)' }}>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>When</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Entity</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Action</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Actor</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>{ts(e.timestamp)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <div>{e.entityType}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{e.entityId}</div>
                  </td>
                  <td style={{ padding: '10px 14px' }}>{e.action}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <div>{e.actorEmail || '—'}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{e.actorUid}</div>
                  </td>
                  <td style={{ padding: '10px 14px', maxWidth: 320, wordBreak: 'break-word' }}>
                    {e.details ? <code style={{ fontSize: 11 }}>{JSON.stringify(e.details)}</code> : '—'}
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
