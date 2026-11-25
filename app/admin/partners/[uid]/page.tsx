'use client';
// Admin view of a single partner's public page. Super admins land here from
// /admin/partners to see what the partner has entered, open their live
// /partner/<slug>, and — if needed — correct a field on their behalf. The
// same card the partner sees on /partner, driven by targetUid on the slug
// API and super-admin writes to the target user doc.

import { use, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import ButtonLink from '@/components/ButtonLink';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import { PARTNER_TYPE_LABELS, PartnerType, UserProfile } from '@/lib/types';
import { PageSkeleton } from '@/components/Skeleton';
import PartnerPublicPageCard from '@/components/PartnerPublicPageCard';

export const dynamic = 'force-dynamic';

type Access = 'checking' | 'ok' | 'denied';

export default function AdminPartnerDetail({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = use(params);
  const [access, setAccess] = useState<Access>('checking');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return setAccess('denied');
      const me = await getDoc(doc(db, 'users', u.uid));
      if (!isSuperAdmin(me.exists() ? (me.data() as UserProfile) : null)) {
        return setAccess('denied');
      }
      setAccess('ok');
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (!snap.exists()) {
          setError('No user profile for that id.');
          return;
        }
        setProfile(snap.data() as UserProfile);
      } catch (err: any) {
        setError(err?.message || 'Could not load the partner.');
      }
    });
  }, [uid]);

  if (access === 'checking') return <PageSkeleton variant="detail" label="Checking access" />;
  if (access === 'denied') {
    return (
      <main className="shell">
        <div className="card">This area is for site administrators.</div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div style={{ marginBottom: 14 }}>
        <ButtonLink href="/admin/partners" className="button secondary small">
          ← Partner applications
        </ButtonLink>
      </div>

      {error && (
        <div className="card">
          <p style={{ color: '#a94442', margin: 0 }}>{error}</p>
        </div>
      )}

      {profile && (
        <>
          <div className="eyebrow">
            {profile.partnerType
              ? PARTNER_TYPE_LABELS[profile.partnerType as PartnerType]
              : 'Partner'}
          </div>
          <h2 style={{ marginBottom: 4 }}>
            {profile.partnerBusinessName || profile.email || 'Partner'}
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            {[profile.email, profile.partnerPhone, profile.partnerWebsite]
              .filter(Boolean)
              .join(' · ')}
          </p>

          <div className="card" style={{ marginTop: 20, background: '#fffdf9' }}>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              You&rsquo;re viewing this partner as a super admin. Any changes you save here write
              directly to their profile and slug. Use it to correct details on a partner&rsquo;s
              behalf — all writes are audited at the Firestore level.
            </p>
          </div>

          {profile.role === 'partner' && profile.partnerStatus === 'approved' ? (
            <div style={{ marginTop: 20 }}>
              <PartnerPublicPageCard uid={uid} profile={profile} />
            </div>
          ) : (
            <div className="card" style={{ marginTop: 20 }}>
              <p className="muted" style={{ margin: 0 }}>
                This user isn&rsquo;t an approved partner, so there&rsquo;s no public page card to
                edit. Current role: <strong>{profile.role || 'unknown'}</strong>, partner status:{' '}
                <strong>{profile.partnerStatus || 'none'}</strong>.
              </p>
            </div>
          )}
        </>
      )}
    </main>
  );
}
