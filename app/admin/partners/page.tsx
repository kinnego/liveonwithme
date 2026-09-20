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
import { PARTNER_TYPE_LABELS, PartnerApplication, UserProfile } from '@/lib/types';
import { writeAudit } from '@/lib/audit';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type Access = 'checking' | 'ok' | 'denied';

export default function AdminPartners() {
  const [access, setAccess] = useState<Access>('checking');
  const [apps, setApps] = useState<PartnerApplication[]>([]);
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
        query(collection(db, 'partnerApplications'), orderBy('createdAt', 'desc')),
        (s) => setApps(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
      );
    });
    return () => {
      stopAuth();
      stop?.();
    };
  }, [router]);

  async function decide(app: PartnerApplication, decision: 'approved' | 'rejected' | 'suspended') {
    if (!auth.currentUser) return;
    setBusy(app.id);
    setError('');
    try {
      await updateDoc(doc(db, 'partnerApplications', app.id), {
        status: decision,
        decidedByUid: auth.currentUser.uid,
        decidedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (decision === 'approved') {
        await updateDoc(doc(db, 'users', app.applicantUid), {
          role: 'partner',
          partnerStatus: 'approved',
          partnerType: app.partnerType,
        });
      } else if (decision === 'suspended') {
        await updateDoc(doc(db, 'users', app.applicantUid), {
          partnerStatus: 'suspended',
        });
      } else if (decision === 'rejected') {
        await updateDoc(doc(db, 'users', app.applicantUid), {
          partnerStatus: 'rejected',
        });
      }

      await writeAudit({
        entityType: 'partnerApplication',
        entityId: app.id,
        action: `decision_${decision}`,
        actorUid: auth.currentUser.uid,
        actorEmail: auth.currentUser.email || undefined,
        details: { applicantUid: app.applicantUid },
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
          <div className="eyebrow">Admin · partners</div>
          <h2 style={{ marginBottom: 0 }}>Partner applications</h2>
        </div>
        <Link href="/admin" className="button secondary">
          Back to console
        </Link>
      </div>

      {error && <p style={{ color: '#a94442', fontSize: 14 }}>{error}</p>}

      {apps.length === 0 ? (
        <div className="card">
          <p className="muted">No applications yet.</p>
        </div>
      ) : (
        apps.map((app) => (
          <div className="card" key={app.id} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0 }}>{app.businessName}</h3>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
                  {PARTNER_TYPE_LABELS[app.partnerType]} · {app.contactName} · {app.applicantEmail}
                </p>
                {app.contactPhone && (
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>
                    {app.contactPhone}
                  </p>
                )}
                {app.website && (
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>
                    <a href={app.website} target="_blank" rel="noopener noreferrer">
                      {app.website}
                    </a>
                  </p>
                )}
                {app.notes && (
                  <p style={{ margin: '10px 0 0', fontSize: 14 }}>{app.notes}</p>
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
                    app.status === 'approved'
                      ? '#dde5df'
                      : app.status === 'rejected'
                        ? '#f4d5d3'
                        : app.status === 'suspended'
                          ? '#ffe8cc'
                          : '#f0e8d8',
                  color:
                    app.status === 'approved'
                      ? '#2f5b48'
                      : app.status === 'rejected'
                        ? '#a94442'
                        : app.status === 'suspended'
                          ? '#a05a00'
                          : '#8b6f30',
                }}
              >
                {app.status}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              {app.status !== 'approved' && (
                <button
                  className="button small"
                  disabled={busy === app.id}
                  onClick={() => decide(app, 'approved')}
                >
                  Approve
                </button>
              )}
              {app.status !== 'suspended' && app.status === 'approved' && (
                <button
                  className="button secondary small"
                  disabled={busy === app.id}
                  onClick={() => decide(app, 'suspended')}
                >
                  Suspend
                </button>
              )}
              {app.status !== 'rejected' && app.status !== 'approved' && (
                <button
                  className="button secondary small"
                  disabled={busy === app.id}
                  onClick={() => decide(app, 'rejected')}
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
