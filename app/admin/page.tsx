'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import { UserProfile } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function AdminHome() {
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking');
  const [orphanCount, setOrphanCount] = useState<{ total: number; due: number } | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return router.push('/auth');
      const snap = await getDoc(doc(db, 'users', u.uid));
      const prof = snap.exists() ? (snap.data() as UserProfile) : null;
      const admin = isSuperAdmin(prof);
      setState(admin ? 'ok' : 'denied');
      if (!admin) return;
      try {
        const token = await u.getIdToken();
        const res = await fetch('/api/admin/orphans/list', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const now = Date.now();
          const due = (data.orphans || []).filter(
            (o: any) => o.pendingDeletionAt && new Date(o.pendingDeletionAt).getTime() <= now,
          ).length;
          setOrphanCount({ total: data.orphans?.length || 0, due });
        }
      } catch {
        // non-blocking; the orphan card still renders without a count
      }
    });
  }, [router]);

  if (state === 'checking') return <PageSkeleton variant="default" label="Checking access" />;

  if (state === 'denied') {
    return (
      <main className="shell">
        <div className="card">
          <h3>This area is for site administrators.</h3>
          <p className="muted">If you believe you should have access, email hello@freastar.com.</p>
        </div>
      </main>
    );
  }

  const orphanBlurb =
    orphanCount === null
      ? 'Orphans awaiting review after an owner deletes their account.'
      : orphanCount.due > 0
        ? `${orphanCount.due} due for review${orphanCount.total > orphanCount.due ? ` · ${orphanCount.total - orphanCount.due} snoozed` : ''}.`
        : orphanCount.total > 0
          ? `${orphanCount.total} snoozed, none due yet.`
          : 'No orphans awaiting review.';

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Admin</div>
          <h2 style={{ marginBottom: 0 }}>Operations console</h2>
        </div>
      </div>

      <div className="featureGrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <Link href="/admin/partners" className="card" style={{ display: 'block' }}>
          <h3>Partners</h3>
          <p className="muted">Approve, suspend or review partner applications.</p>
        </Link>
        <Link href="/admin/succession" className="card" style={{ display: 'block' }}>
          <h3>Succession requests</h3>
          <p className="muted">Family requests to take over a memorial.</p>
        </Link>
        <Link href="/admin/memorials" className="card" style={{ display: 'block' }}>
          <h3>Memorials &amp; plots</h3>
          <p className="muted">Search, resolve stuck cases, view audit trail.</p>
        </Link>
        <Link href="/admin/cemeteries" className="card" style={{ display: 'block' }}>
          <h3>Cemetery reports</h3>
          <p className="muted">Review reported community-added cemetery listings.</p>
        </Link>
        <Link href="/admin/registrars" className="card" style={{ display: 'block' }}>
          <h3>Cemetery registrars</h3>
          <p className="muted">See who keeps each burial register and act on reported entries.</p>
        </Link>
        <Link href="/admin/reports" className="card" style={{ display: 'block' }}>
          <h3>Reported memories</h3>
          <p className="muted">Review visitor reports on contributions to public memorials.</p>
        </Link>
        <Link href="/admin/orphans" className="card" style={{ display: 'block', position: 'relative' }}>
          <h3>
            Orphaned memorials
            {orphanCount && orphanCount.due > 0 && (
              <span
                style={{
                  display: 'inline-block',
                  marginLeft: 8,
                  background: '#b2432b',
                  color: 'white',
                  borderRadius: 999,
                  padding: '2px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                  verticalAlign: 'middle',
                }}
              >
                {orphanCount.due}
              </span>
            )}
          </h3>
          <p className="muted">{orphanBlurb}</p>
        </Link>
        <Link href="/admin/config" className="card" style={{ display: 'block' }}>
          <h3>Pricing &amp; media quotas</h3>
          <p className="muted">Adjust configurable limits without redeploying.</p>
        </Link>
        <Link href="/admin/audit" className="card" style={{ display: 'block' }}>
          <h3>Audit log</h3>
          <p className="muted">Recent state changes across the platform.</p>
        </Link>
        <Link href="/admin/backfill-variants" className="card" style={{ display: 'block' }}>
          <h3>Image variants backfill</h3>
          <p className="muted">Generate resized WebP siblings for pre-existing memorial photos.</p>
        </Link>
        <Link href="/demo-qr" className="card" style={{ display: 'block' }}>
          <h3>Demo QR</h3>
          <p className="muted">Printable card linking to the sample memorial. Shared with partners.</p>
        </Link>
      </div>
    </main>
  );
}
