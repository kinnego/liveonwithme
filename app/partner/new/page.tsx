'use client';
import { FormEvent, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { DEFAULT_PRICING, UserProfile } from '@/lib/types';
import { isSuperAdmin, isApprovedPartner } from '@/lib/roles';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function NewPartnerCustomer() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return router.push('/auth');
      const profSnap = await getDoc(doc(db, 'users', u.uid));
      const prof = profSnap.exists() ? (profSnap.data() as UserProfile) : null;
      setOk(isSuperAdmin(prof) || isApprovedPartner(prof));
    });
  }, [router]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auth.currentUser) return;
    setError('');
    setSaving(true);
    try {
      const fd = new FormData(e.currentTarget);
      const bereavedEmail = String(fd.get('bereavedEmail')).trim().toLowerCase();
      const referral = {
        partnerUid: auth.currentUser.uid,
        bereavedName: String(fd.get('bereavedName')),
        bereavedEmail,
        bereavedPhone: String(fd.get('bereavedPhone') || ''),
        bereavedRelationship: String(fd.get('bereavedRelationship') || ''),
        deceasedFullName: String(fd.get('deceasedFullName')),
        deceasedNickname: String(fd.get('deceasedNickname') || ''),
        deceasedShortName: String(fd.get('deceasedShortName') || ''),
        deceasedAddress: String(fd.get('deceasedAddress') || ''),
        deceasedBorn: String(fd.get('deceasedBorn') || ''),
        deceasedDied: String(fd.get('deceasedDied') || ''),
        status: 'pending' as const,
        wholesalePaymentStatus: 'unpaid' as const,
        wholesaleAmountCents: DEFAULT_PRICING.partnerWholesalePriceCents,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, 'referrals'), referral);

      // Now redirect to Stripe for €150 wholesale payment.
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/partner/wholesale-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ referralId: ref.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start payment');
      window.location.href = data.checkoutUrl;
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (ok === null) return <PageSkeleton variant="form" label="Checking your access" />;

  if (!ok) {
    return (
      <main className="shell">
        <div className="formCard">
          <div className="eyebrow">Partner access needed</div>
          <h2>This page is for approved partners.</h2>
          <p className="muted">
            If you&rsquo;d like to offer memorials to your customers, apply to become a partner and
            we&rsquo;ll get back to you within a working day.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <a href="/partner/apply" className="button">Apply</a>
            <a href="/dashboard" className="button secondary">Go to my dashboard</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">Set up a new memorial</div>
        <h2>Start a memorial for a family.</h2>
        <p className="muted">
          These details create the initial page. You pay <strong>€150</strong> today and we email
          the family a private link to take it over, add photographs and stories, and go live.
          You bill your customer separately at whatever price fits your business — Live On With Me
          never touches that transaction.
        </p>
        <form onSubmit={submit}>
          <h3 style={{ marginTop: 20 }}>Bereaved contact</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            The person who will take over the memorial and add content.
          </p>
          <label htmlFor="bereavedName">Their name</label>
          <input id="bereavedName" name="bereavedName" required />
          <div className="twoCol">
            <div>
              <label htmlFor="bereavedEmail">Email</label>
              <input id="bereavedEmail" name="bereavedEmail" type="email" required />
            </div>
            <div>
              <label htmlFor="bereavedPhone">Phone</label>
              <input id="bereavedPhone" name="bereavedPhone" type="tel" />
            </div>
          </div>
          <label htmlFor="bereavedRelationship">Relationship to the deceased</label>
          <input id="bereavedRelationship" name="bereavedRelationship" placeholder="e.g. daughter, husband" />

          <h3 style={{ marginTop: 30 }}>About the deceased</h3>
          <label htmlFor="deceasedFullName">Full name</label>
          <input id="deceasedFullName" name="deceasedFullName" placeholder="Mary O'Donnell" required />
          <div className="twoCol">
            <div>
              <label htmlFor="deceasedNickname">Nickname</label>
              <input id="deceasedNickname" name="deceasedNickname" placeholder="e.g. Mary-Anne" />
            </div>
            <div>
              <label htmlFor="deceasedShortName">Commonly known as</label>
              <input id="deceasedShortName" name="deceasedShortName" placeholder="e.g. Mo" />
            </div>
          </div>
          <label htmlFor="deceasedAddress">Address</label>
          <input id="deceasedAddress" name="deceasedAddress" placeholder="Home address" />
          <div className="twoCol">
            <div>
              <label htmlFor="deceasedBorn">Born</label>
              <input id="deceasedBorn" name="deceasedBorn" type="date" />
            </div>
            <div>
              <label htmlFor="deceasedDied">Died</label>
              <input id="deceasedDied" name="deceasedDied" type="date" />
            </div>
          </div>

          {error && <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{error}</p>}

          <button disabled={saving} className="button" style={{ width: '100%', marginTop: 26 }}>
            {saving ? 'Setting up payment…' : 'Continue — pay €150 to send invite'}
          </button>
          <p className="muted" style={{ fontSize: 13, marginTop: 14, textAlign: 'center' }}>
            Payment is taken securely by Stripe. The family will only be invited after payment succeeds.
          </p>
        </form>
      </div>
    </main>
  );
}
