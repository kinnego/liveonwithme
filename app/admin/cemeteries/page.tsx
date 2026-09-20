'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  deleteDoc,
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
import { customPlaceIdOf } from '@/lib/cemeteries';
import { writeAudit } from '@/lib/audit';
import { CemeteryReport, CustomCemetery, UserProfile } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type Access = 'checking' | 'ok' | 'denied';

export default function AdminCemeteries() {
  const [access, setAccess] = useState<Access>('checking');
  const [reports, setReports] = useState<CemeteryReport[]>([]);
  const [cemeteries, setCemeteries] = useState<Record<string, CustomCemetery>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (!auth) return;
    let stop: (() => void) | undefined;
    const stopAuth = onAuthStateChanged(auth, async (u) => {
      stop?.();
      stop = undefined;
      if (!u) {
        router.push('/auth');
        return;
      }
      const snap = await getDoc(doc(db, 'users', u.uid));
      const prof = snap.exists() ? (snap.data() as UserProfile) : null;
      if (!isSuperAdmin(prof)) {
        setAccess('denied');
        return;
      }
      setAccess('ok');
      stop = onSnapshot(
        query(collection(db, 'cemeteryReports'), orderBy('createdAt', 'desc')),
        (s) => setReports(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      );
    });
    return () => {
      stopAuth();
      stop?.();
    };
  }, [router]);

  // Hydrate the referenced cemetery docs so we can show name/address inline.
  useEffect(() => {
    if (access !== 'ok') return;
    const missing = Array.from(new Set(reports.map((r) => r.cemeteryId))).filter(
      (id) => !cemeteries[id],
    );
    if (missing.length === 0) return;
    (async () => {
      const entries: [string, CustomCemetery][] = [];
      for (const id of missing) {
        try {
          const snap = await getDoc(doc(db, 'cemeteries', id));
          if (snap.exists()) entries.push([id, { id, ...(snap.data() as any) }]);
        } catch {
          // A deleted cemetery still leaves orphan reports; we surface those
          // as "cemetery deleted" in the UI.
        }
      }
      if (entries.length === 0) return;
      setCemeteries((prev) => {
        const next = { ...prev };
        for (const [id, c] of entries) next[id] = c;
        return next;
      });
    })();
  }, [reports, access, cemeteries]);

  async function dismissReport(report: CemeteryReport) {
    if (!auth.currentUser) return;
    setBusy(report.id);
    setError('');
    try {
      await updateDoc(doc(db, 'cemeteryReports', report.id), {
        status: 'dismissed',
        decidedByUid: auth.currentUser.uid,
        decidedAt: serverTimestamp(),
      });
      await writeAudit({
        entityType: 'user',
        entityId: report.id,
        action: 'cemetery_report_dismissed',
        actorUid: auth.currentUser.uid,
        actorEmail: auth.currentUser.email || undefined,
        details: { cemeteryId: report.cemeteryId },
      });
    } catch (err: any) {
      setError(err?.message || 'Could not update the report.');
    } finally {
      setBusy(null);
    }
  }

  async function deleteCemetery(report: CemeteryReport) {
    if (!auth.currentUser) return;
    if (!confirm('Delete this cemetery entry? Any memorials attached to it will still exist but the cemetery page will 404.')) return;
    setBusy(report.id);
    setError('');
    try {
      await deleteDoc(doc(db, 'cemeteries', report.cemeteryId));
      // Mark this report actioned, and any other open reports for the same
      // cemetery too — otherwise they'd hang around forever with no target.
      const openForSame = reports.filter(
        (r) => r.cemeteryId === report.cemeteryId && r.status === 'open',
      );
      for (const r of openForSame) {
        await updateDoc(doc(db, 'cemeteryReports', r.id), {
          status: 'actioned',
          decidedByUid: auth.currentUser.uid,
          decidedAt: serverTimestamp(),
        });
      }
      await writeAudit({
        entityType: 'user',
        entityId: report.cemeteryId,
        action: 'cemetery_deleted',
        actorUid: auth.currentUser.uid,
        actorEmail: auth.currentUser.email || undefined,
        details: { reportId: report.id, reason: report.reason },
      });
    } catch (err: any) {
      setError(err?.message || 'Could not delete the cemetery.');
    } finally {
      setBusy(null);
    }
  }

  const openReports = useMemo(
    () => reports.filter((r) => r.status === 'open'),
    [reports],
  );
  const closedReports = useMemo(
    () => reports.filter((r) => r.status !== 'open'),
    [reports],
  );

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
          <div className="eyebrow">Admin · cemeteries</div>
          <h2 style={{ marginBottom: 0 }}>Reported cemetery listings</h2>
        </div>
        <Link href="/admin" className="button secondary">
          Back to console
        </Link>
      </div>

      {error && <p style={{ color: '#a94442', fontSize: 14 }}>{error}</p>}

      <h3 style={{ marginTop: 30, marginBottom: 12 }}>Open ({openReports.length})</h3>
      {openReports.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>No open reports.</p>
        </div>
      ) : (
        openReports.map((r) => (
          <ReportCard
            key={r.id}
            report={r}
            cemetery={cemeteries[r.cemeteryId]}
            busy={busy === r.id}
            onDismiss={() => dismissReport(r)}
            onDelete={() => deleteCemetery(r)}
          />
        ))
      )}

      {closedReports.length > 0 && (
        <>
          <h3 style={{ marginTop: 40, marginBottom: 12 }}>Resolved</h3>
          {closedReports.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              cemetery={cemeteries[r.cemeteryId]}
              busy={false}
              readOnly
            />
          ))}
        </>
      )}
    </main>
  );
}

function ReportCard({
  report,
  cemetery,
  busy,
  onDismiss,
  onDelete,
  readOnly,
}: {
  report: CemeteryReport;
  cemetery?: CustomCemetery;
  busy: boolean;
  onDismiss?: () => void;
  onDelete?: () => void;
  readOnly?: boolean;
}) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0 }}>
            {cemetery ? (
              <Link
                href={`/cemetery/${customPlaceIdOf(cemetery.id)}`}
                style={{ textDecoration: 'underline' }}
              >
                {cemetery.name}
              </Link>
            ) : (
              <span className="muted">(cemetery deleted)</span>
            )}
          </h3>
          {cemetery?.address && (
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              {cemetery.address}
            </p>
          )}
          <p style={{ margin: '10px 0 0', fontSize: 14 }}>
            <strong>Reason:</strong> {report.reason}
          </p>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            Reporter: {report.reporterEmail || (report.reporterUid ? `uid ${report.reporterUid}` : 'anonymous')}
          </p>
          {cemetery && (
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
              Cemetery submitter: {cemetery.createdByEmail || (cemetery.createdByUid ? `uid ${cemetery.createdByUid}` : 'unknown')}
            </p>
          )}
        </div>
        <span
          style={{
            display: 'inline-block',
            height: 'fit-content',
            borderRadius: 999,
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 750,
            background:
              report.status === 'open'
                ? '#f0e8d8'
                : report.status === 'actioned'
                  ? '#dde5df'
                  : '#eae4d8',
            color:
              report.status === 'open'
                ? '#8b6f30'
                : report.status === 'actioned'
                  ? '#2f5b48'
                  : 'var(--muted)',
          }}
        >
          {report.status}
        </span>
      </div>

      {!readOnly && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="button secondary small"
            disabled={busy}
            onClick={onDismiss}
          >
            Dismiss report
          </button>
          {cemetery && (
            <button
              type="button"
              className="button small"
              disabled={busy}
              onClick={onDelete}
              style={{ background: '#a94442' }}
            >
              Delete this cemetery
            </button>
          )}
        </div>
      )}
    </div>
  );
}
