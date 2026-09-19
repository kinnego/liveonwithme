'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import { SuccessionRequest, UserProfile } from '@/lib/types';
import { writeAudit } from '@/lib/audit';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type Access = 'checking' | 'ok' | 'denied';

export default function AdminSuccession() {
  const [access, setAccess] = useState<Access>('checking');
  const [rows, setRows] = useState<SuccessionRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
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
        query(collection(db, 'successionRequests'), orderBy('createdAt', 'desc')),
        (s) => setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
      );
      return () => stop();
    });
  }, [router]);

  async function updateStatus(row: SuccessionRequest, status: SuccessionRequest['status']) {
    if (!auth.currentUser) return;
    setBusy(row.id);
    setError('');
    try {
      await updateDoc(doc(db, 'successionRequests', row.id), {
        status,
        resolutionNotes: notes[row.id] || row.resolutionNotes || '',
        resolvedAt: status === 'resolved' ? serverTimestamp() : row.resolvedAt || null,
        updatedAt: serverTimestamp(),
      });
      await writeAudit({
        entityType: 'successionRequest',
        entityId: row.id,
        action: `status_${status}`,
        actorUid: auth.currentUser.uid,
        actorEmail: auth.currentUser.email || undefined,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

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
          <div className="eyebrow">Admin · succession</div>
          <h2 style={{ marginBottom: 0 }}>Family succession requests</h2>
        </div>
        <Link href="/admin" className="button secondary">
          Back to console
        </Link>
      </div>

      {error && <p style={{ color: '#a94442', fontSize: 14 }}>{error}</p>}

      {rows.length === 0 ? (
        <div className="card">
          <p className="muted">No succession requests yet.</p>
        </div>
      ) : (
        rows.map((r) => (
          <div className="card" key={r.id} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0 }}>
                  {r.requesterName} <span className="muted" style={{ fontWeight: 400 }}>(re: {r.personName})</span>
                </h3>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
                  {r.requesterEmail}
                  {r.requesterPhone && ` · ${r.requesterPhone}`}
                  {' · '}
                  {r.requesterRelationship}
                </p>
                {r.memorialId && (
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>
                    Memorial referenced: <code>{r.memorialId}</code>
                  </p>
                )}
                {r.invitedPartnerEmail && (
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>
                    Partner they mentioned: {r.invitedPartnerEmail}
                  </p>
                )}
              </div>
              <span
                style={{
                  height: 'fit-content',
                  borderRadius: 999,
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 750,
                  background:
                    r.status === 'resolved'
                      ? '#dde5df'
                      : r.status === 'rejected'
                        ? '#f4d5d3'
                        : r.status === 'assigned'
                          ? '#e8f0fa'
                          : '#f0e8d8',
                  color:
                    r.status === 'resolved'
                      ? '#2f5b48'
                      : r.status === 'rejected'
                        ? '#a94442'
                        : r.status === 'assigned'
                          ? '#2f4b70'
                          : '#8b6f30',
                }}
              >
                {r.status}
              </span>
            </div>

            <label style={{ marginTop: 14 }}>Resolution notes (private)</label>
            <textarea
              value={notes[r.id] ?? r.resolutionNotes ?? ''}
              onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
              placeholder="e.g. spoke with requester, verified identity via funeral director"
            />

            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              {r.status !== 'assigned' && r.status !== 'resolved' && (
                <button
                  className="button secondary small"
                  disabled={busy === r.id}
                  onClick={() => updateStatus(r, 'assigned')}
                >
                  Mark assigned
                </button>
              )}
              {r.status !== 'resolved' && (
                <button
                  className="button small"
                  disabled={busy === r.id}
                  onClick={() => updateStatus(r, 'resolved')}
                >
                  Mark resolved
                </button>
              )}
              {r.status !== 'rejected' && (
                <button
                  className="button secondary small"
                  disabled={busy === r.id}
                  onClick={() => updateStatus(r, 'rejected')}
                >
                  Reject
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </main>
  );
}
