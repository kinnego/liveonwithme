'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { PARTNER_TYPE_LABELS, PartnerStatus, PartnerType, UserProfile } from '@/lib/types';
import { isSuperAdmin } from '@/lib/roles';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type Access = 'checking' | 'not_signed_in' | 'no_profile' | 'not_partner' | 'pending' | 'suspended' | 'ok';

function statusLabel(s: string) {
  return s === 'claimed' ? 'Family invited' : s.charAt(0).toUpperCase() + s.slice(1);
}
function wholesaleLabel(s: string) {
  if (s === 'paid') return 'Wholesale paid';
  if (s === 'refunded') return 'Refunded';
  return 'Wholesale unpaid';
}

export default function PartnerDashboard() {
  const [access, setAccess] = useState<Access>('checking');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!auth) {
      setAccess('not_signed_in');
      return;
    }
    let stop: (() => void) | undefined;
    const off = onAuthStateChanged(auth, async (u) => {
      // Tear down first: the referrals query filters on partnerUid == u.uid,
      // so on signout it would re-evaluate under no auth and throw
      // permission-denied.
      stop?.();
      stop = undefined;
      if (!u) {
        setAccess('not_signed_in');
        router.push('/auth');
        return;
      }
      const profSnap = await getDoc(doc(db, 'users', u.uid));
      if (!profSnap.exists()) {
        setAccess('no_profile');
        return;
      }
      const prof = profSnap.data() as UserProfile;
      setProfile(prof);

      const admin = isSuperAdmin(prof);
      if (prof.role !== 'partner' && !admin) {
        setAccess('not_partner');
        return;
      }
      if (!admin) {
        if (prof.partnerStatus === 'pending') return setAccess('pending');
        if (prof.partnerStatus === 'suspended') return setAccess('suspended');
        if (prof.partnerStatus !== 'approved') return setAccess('not_partner');
      }
      setAccess('ok');
      stop = onSnapshot(
        query(
          collection(db, 'referrals'),
          where('partnerUid', '==', u.uid),
          orderBy('createdAt', 'desc')
        ),
        (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() })))
      );
    });
    return () => {
      off();
      stop?.();
    };
  }, [router]);

  if (access === 'checking' || access === 'not_signed_in') {
    return <PageSkeleton variant="detail" label="Checking your access" />;
  }

  if (access === 'no_profile' || access === 'not_partner') {
    return (
      <main className="shell">
        <div className="formCard">
          <div className="eyebrow">Become a partner</div>
          <h2>Sell Live On With Me to the families you serve.</h2>
          <p className="muted">
            Funeral directors, stonemasons, priests and community organisations can
            offer memorial pages to the families in their care. Once approved,
            we&rsquo;ll share the wholesale terms with you directly and you charge your
            customer separately at whatever price fits your business.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
            <Link href="/partner/apply" className="button">Apply to become a partner</Link>
            <Link href="/dashboard" className="button secondary">Go to my dashboard</Link>
          </div>
        </div>
      </main>
    );
  }

  if (access === 'pending') {
    return (
      <main className="shell">
        <div className="formCard">
          <div className="eyebrow">Application received</div>
          <h2>Thanks. We&rsquo;ll be in touch.</h2>
          <p className="muted">
            Your partner application is with our team. We&rsquo;ll email you at{' '}
            <strong>{profile?.email}</strong> once it&rsquo;s approved. Most decisions take a working day.
          </p>
        </div>
      </main>
    );
  }

  if (access === 'suspended') {
    return (
      <main className="shell">
        <div className="formCard">
          <div className="eyebrow">Account paused</div>
          <h2>Your partner account is currently paused.</h2>
          <p className="muted">
            Please email <a href="mailto:hello@freastar.com">hello@freastar.com</a> and we&rsquo;ll help sort it.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Partner</div>
          <h2 style={{ marginBottom: 4 }}>Your customers</h2>
          <p className="muted" style={{ margin: 0 }}>
            {profile?.partnerType ? PARTNER_TYPE_LABELS[profile.partnerType as PartnerType] : 'Approved partner'}
          </p>
        </div>
        <Link href="/partner/new" className="button">Set up a new memorial</Link>
      </div>

      <div className="card" style={{ marginBottom: 30, background: '#fffdf9' }}>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          You pay <strong>€150</strong> to Live On With Me per memorial. You bill your customer separately at
          whatever price you choose. We don&rsquo;t take a percentage. There are no commissions or payouts back to you.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="card">
          <h3>No memorials set up yet</h3>
          <p className="muted">
            When a family engages you for a service, start their memorial here. They&rsquo;ll get an invite
            to take it over and add photographs and stories.
          </p>
          <Link href="/partner/new" className="button" style={{ marginTop: 12 }}>Set up a new memorial</Link>
        </div>
      ) : (
        <div className="featureGrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {items.map((r) => (
            <Link href={`/partner/referrals/${r.id}`} key={r.id} className="card" style={{ display: 'block' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <span className="status">{statusLabel(r.status)}</span>
                <span className="status" style={{ background: r.wholesalePaymentStatus === 'paid' ? '#dde5df' : '#ffe8cc' }}>
                  {wholesaleLabel(r.wholesalePaymentStatus)}
                </span>
              </div>
              <h3 style={{ margin: 0 }}>{r.deceasedFullName}</h3>
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
                Contact: {r.bereavedName}
              </p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
