'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import { ContributionReport, Memorial, UserProfile } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type Access = 'checking' | 'ok' | 'denied';
type Decision = 'actioned' | 'dismissed';

function timeAgo(ts: any): string {
  const ms = ts?.toMillis?.() ?? (typeof ts === 'number' ? ts : null);
  if (!ms) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(ms).toLocaleDateString('en-IE');
}

export default function AdminContributionReports() {
  const [access, setAccess] = useState<Access>('checking');
  const [reports, setReports] = useState<ContributionReport[]>([]);
  const [memorials, setMemorials] = useState<Record<string, Memorial>>({});
  const [contribs, setContribs] = useState<
    Record<string, { memory?: string; contributorName?: string; status?: string } | null>
  >({});
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [busyId, setBusyId] = useState<string | null>(null);
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
    });
  }, [router]);

  useEffect(() => {
    if (access !== 'ok') return;
    const base = collection(db, 'contributionReports');
    const q =
      filter === 'open'
        ? query(base, where('status', '==', 'open'), orderBy('createdAt', 'desc'), limit(100))
        : query(base, orderBy('createdAt', 'desc'), limit(100));
    return onSnapshot(q, (snap) => {
      const next = snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as any) }) as ContributionReport,
      );
      setReports(next);
    });
  }, [access, filter]);

  // Hydrate the memorial + contribution each report points at, so we can
  // show the memory text alongside the report. Keyed by id so repeated
  // fetches are deduped.
  useEffect(() => {
    if (!reports.length) return;
    const missingMemorials = new Set<string>();
    const missingContribs = new Set<string>();
    for (const r of reports) {
      if (r.memorialId && !memorials[r.memorialId]) missingMemorials.add(r.memorialId);
      if (r.contributionId && contribs[r.contributionId] === undefined)
        missingContribs.add(r.contributionId);
    }
    (async () => {
      for (const id of missingMemorials) {
        try {
          const s = await getDoc(doc(db, 'memorials', id));
          if (s.exists()) setMemorials((x) => ({ ...x, [id]: { id: s.id, ...(s.data() as any) } }));
        } catch {
          // Ignore — row renders with a fallback label.
        }
      }
      for (const id of missingContribs) {
        try {
          const s = await getDoc(doc(db, 'contributions', id));
          setContribs((x) => ({ ...x, [id]: s.exists() ? (s.data() as any) : null }));
        } catch {
          setContribs((x) => ({ ...x, [id]: null }));
        }
      }
    })();
  }, [reports, memorials, contribs]);

  async function decide(reportId: string, decision: Decision) {
    if (!auth.currentUser) return;
    setBusyId(reportId);
    try {
      await updateDoc(doc(db, 'contributionReports', reportId), {
        status: decision,
        decidedByUid: auth.currentUser.uid,
        decidedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('report decision failed', err);
    } finally {
      setBusyId(null);
    }
  }

  async function hideContribution(contributionId: string, reportId: string) {
    if (!auth.currentUser) return;
    setBusyId(reportId);
    try {
      // Flip the contribution back to 'rejected' so it leaves the public
      // view immediately. The family can still restore it via their inbox
      // if they disagree with the decision.
      await updateDoc(doc(db, 'contributions', contributionId), {
        status: 'rejected',
      });
      await updateDoc(doc(db, 'contributionReports', reportId), {
        status: 'actioned',
        decidedByUid: auth.currentUser.uid,
        decidedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('hide contribution failed', err);
    } finally {
      setBusyId(null);
    }
  }

  if (access === 'checking')
    return <PageSkeleton variant="detail" label="Checking access" />;
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
          <div className="eyebrow">Admin · reports</div>
          <h2 style={{ marginBottom: 0 }}>Reported memories</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {filter === 'open'
              ? `${reports.length} open report${reports.length === 1 ? '' : 's'}.`
              : `Last ${reports.length} report${reports.length === 1 ? '' : 's'}.`}
          </p>
        </div>
        <Link href="/admin" className="button secondary">
          Back to console
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '0 0 20px' }}>
        <button
          onClick={() => setFilter('open')}
          className={`button small ${filter === 'open' ? '' : 'secondary'}`}
        >
          Open
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`button small ${filter === 'all' ? '' : 'secondary'}`}
        >
          All
        </button>
      </div>

      {reports.length === 0 ? (
        <div className="card">
          <p className="muted">Nothing to review.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {reports.map((r) => {
            const m = memorials[r.memorialId];
            const c = contribs[r.contributionId];
            const isOpen = r.status === 'open';
            return (
              <div key={r.id} className="card">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 12,
                    flexWrap: 'wrap',
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 4 }}>
                      {r.status === 'open'
                        ? 'Open'
                        : r.status === 'actioned'
                          ? 'Actioned'
                          : 'Dismissed'}
                      {' · '}
                      {timeAgo(r.createdAt)}
                    </div>
                    <h3 style={{ margin: 0 }}>
                      {m?.fullName ? (
                        <Link href={`/m/${m.slug}`} target="_blank" rel="noopener">
                          {m.fullName}
                        </Link>
                      ) : (
                        'Memorial'
                      )}
                    </h3>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Reporter: {r.reporterEmail || (r.reporterUid ? 'signed-in' : 'anonymous')}
                  </div>
                </div>

                <div
                  style={{
                    background: '#faf7f0',
                    border: '1px solid #e6dfc9',
                    borderRadius: 12,
                    padding: '12px 14px',
                    margin: '0 0 14px',
                    fontSize: 14,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {r.reason}
                </div>

                <div className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>
                  {c === undefined ? (
                    'Loading memory…'
                  ) : c === null ? (
                    <em>The reported memory has been removed.</em>
                  ) : (
                    <>
                      <strong style={{ color: '#25312d', fontWeight: 650 }}>
                        {c.contributorName || 'Someone'}
                      </strong>{' '}
                      wrote: &ldquo;{(c.memory || '').slice(0, 400)}
                      {(c.memory || '').length > 400 ? '…' : ''}&rdquo;
                      {c.status && c.status !== 'approved' && (
                        <span style={{ marginLeft: 8, fontSize: 12 }}>
                          [currently {c.status}]
                        </span>
                      )}
                    </>
                  )}
                </div>

                {isOpen && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {c && c.status !== 'rejected' && (
                      <button
                        onClick={() => hideContribution(r.contributionId, r.id)}
                        disabled={busyId === r.id}
                        className="button small"
                      >
                        Hide memory + mark actioned
                      </button>
                    )}
                    <button
                      onClick={() => decide(r.id, 'actioned')}
                      disabled={busyId === r.id}
                      className="button small secondary"
                    >
                      Mark actioned
                    </button>
                    <button
                      onClick={() => decide(r.id, 'dismissed')}
                      disabled={busyId === r.id}
                      className="button small secondary"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
