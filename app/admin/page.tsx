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
  const router = useRouter();

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return router.push('/auth');
      const snap = await getDoc(doc(db, 'users', u.uid));
      const prof = snap.exists() ? (snap.data() as UserProfile) : null;
      setState(isSuperAdmin(prof) ? 'ok' : 'denied');
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
        <Link href="/admin/config" className="card" style={{ display: 'block' }}>
          <h3>Pricing &amp; media quotas</h3>
          <p className="muted">Adjust configurable limits without redeploying.</p>
        </Link>
        <Link href="/admin/audit" className="card" style={{ display: 'block' }}>
          <h3>Audit log</h3>
          <p className="muted">Recent state changes across the platform.</p>
        </Link>
      </div>
    </main>
  );
}
