'use client';
import { FormEvent, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { PARTNER_TYPE_LABELS, PartnerType } from '@/lib/types';
import { writeAudit } from '@/lib/audit';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function PartnerApply() {
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push('/auth?next=/partner/apply');
        return;
      }
      // Ensure profile exists so the write to /users below works.
      const profRef = doc(db, 'users', u.uid);
      const snap = await getDoc(profRef);
      if (!snap.exists()) {
        await setDoc(profRef, {
          uid: u.uid,
          email: u.email || '',
          role: 'family',
          createdAt: serverTimestamp(),
        });
      }
      setReady(true);
    });
  }, [router]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auth.currentUser) return;
    setError('');
    setSaving(true);
    try {
      const fd = new FormData(e.currentTarget);
      const app = await addDoc(collection(db, 'partnerApplications'), {
        applicantUid: auth.currentUser.uid,
        applicantEmail: auth.currentUser.email || '',
        partnerType: String(fd.get('partnerType')) as PartnerType,
        businessName: String(fd.get('businessName')),
        contactName: String(fd.get('contactName')),
        contactPhone: String(fd.get('contactPhone') || ''),
        website: String(fd.get('website') || ''),
        notes: String(fd.get('notes') || ''),
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        partnerApplicationId: app.id,
      });

      await writeAudit({
        entityType: 'partnerApplication',
        entityId: app.id,
        action: 'submitted',
        actorUid: auth.currentUser.uid,
        actorEmail: auth.currentUser.email || undefined,
      });

      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return <PageSkeleton variant="form" label="Loading application form" />;

  if (done) {
    return (
      <main className="shell">
        <div className="formCard">
          <div className="eyebrow">Application received</div>
          <h2>Thank you.</h2>
          <p className="muted">
            We&rsquo;ll review your application and reply within a working day. Once approved,
            you&rsquo;ll see &lsquo;Set up a new memorial&rsquo; on your partner dashboard.
          </p>
          <a href="/dashboard" className="button" style={{ marginTop: 20 }}>Back to my dashboard</a>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">Partner application</div>
        <h2>Join the partner network.</h2>
        <p className="muted">
          Live On With Me partners offer memorial pages to the families they serve as
          part of their own service. Once approved, you&rsquo;ll be able to set up
          memorials on behalf of families and receive the wholesale terms we&rsquo;ll
          share directly with you after we review your application.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="partnerType">Your role</label>
          <select id="partnerType" name="partnerType" required defaultValue="funeral_director">
            {(Object.keys(PARTNER_TYPE_LABELS) as PartnerType[]).map((t) => (
              <option key={t} value={t}>{PARTNER_TYPE_LABELS[t]}</option>
            ))}
          </select>

          <label htmlFor="businessName">Business or organisation name</label>
          <input id="businessName" name="businessName" required />

          <div className="twoCol">
            <div>
              <label htmlFor="contactName">Your name</label>
              <input id="contactName" name="contactName" required />
            </div>
            <div>
              <label htmlFor="contactPhone">Phone</label>
              <input id="contactPhone" name="contactPhone" type="tel" />
            </div>
          </div>

          <label htmlFor="website">Website (optional)</label>
          <input id="website" name="website" type="url" placeholder="https://" />

          <label htmlFor="notes">Anything else we should know?</label>
          <textarea id="notes" name="notes" placeholder="How many families do you typically serve? Any specific needs?" />

          {error && <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{error}</p>}

          <button disabled={saving} className="button" style={{ width: '100%', marginTop: 26 }}>
            {saving ? 'Sending…' : 'Submit application'}
          </button>
        </form>
      </div>
    </main>
  );
}
