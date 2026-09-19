'use client';
import { FormEvent, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { writeAudit } from '@/lib/audit';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function SuccessionRequest() {
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push('/auth?next=/help/succession');
        return;
      }
      const prof = doc(db, 'users', u.uid);
      const snap = await getDoc(prof);
      if (!snap.exists()) {
        await setDoc(prof, {
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
    setSaving(true);
    setError('');
    try {
      const fd = new FormData(e.currentTarget);
      const req = await addDoc(collection(db, 'successionRequests'), {
        requesterUid: auth.currentUser.uid,
        requesterName: String(fd.get('requesterName')),
        requesterEmail: auth.currentUser.email || String(fd.get('requesterEmail') || ''),
        requesterPhone: String(fd.get('requesterPhone') || ''),
        requesterRelationship: String(fd.get('requesterRelationship')),
        personName: String(fd.get('personName')),
        memorialId: String(fd.get('memorialId') || '') || undefined,
        invitedPartnerEmail: String(fd.get('invitedPartnerEmail') || '') || undefined,
        assignedToLoWMAdmin: !fd.get('invitedPartnerEmail'),
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeAudit({
        entityType: 'successionRequest',
        entityId: req.id,
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

  if (!ready) return <PageSkeleton variant="form" label="Loading" />;

  if (done) {
    return (
      <main className="shell">
        <div className="formCard">
          <div className="eyebrow">Received</div>
          <h2>Thank you.</h2>
          <p className="muted">
            We&rsquo;ve received your request. Our team will be in touch within one working day
            to help you take over the memorial. If the family has a funeral director they trust,
            we may involve them in the verification.
          </p>
          <a href="/dashboard" className="button" style={{ marginTop: 20 }}>Go to my dashboard</a>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">Need help</div>
        <h2>Help managing someone&rsquo;s memorial</h2>
        <p className="muted">
          If the person who created a memorial has died and no successor was nominated, we can
          help you take it over. Please tell us a little about yourself and them — we&rsquo;ll then
          walk you through a short verification and, where possible, involve their funeral
          director.
        </p>
        <form onSubmit={submit}>
          <h3>About the person</h3>
          <label htmlFor="personName">Their full name</label>
          <input id="personName" name="personName" required />
          <label htmlFor="memorialId">If you know the memorial link, share it here</label>
          <input id="memorialId" name="memorialId" placeholder="e.g. mary-odonnell-a3f2" />

          <h3 style={{ marginTop: 24 }}>About you</h3>
          <label htmlFor="requesterName">Your name</label>
          <input id="requesterName" name="requesterName" required />
          <label htmlFor="requesterRelationship">Your relationship to them</label>
          <input id="requesterRelationship" name="requesterRelationship" placeholder="e.g. daughter, executor, close friend" required />
          <div className="twoCol">
            <div>
              <label htmlFor="requesterEmail">Confirm your email</label>
              <input id="requesterEmail" name="requesterEmail" type="email" defaultValue={auth?.currentUser?.email || ''} />
            </div>
            <div>
              <label htmlFor="requesterPhone">Phone (optional)</label>
              <input id="requesterPhone" name="requesterPhone" type="tel" />
            </div>
          </div>

          <h3 style={{ marginTop: 24 }}>Any partner involved?</h3>
          <label htmlFor="invitedPartnerEmail">Funeral director email (optional)</label>
          <input id="invitedPartnerEmail" name="invitedPartnerEmail" type="email" placeholder="If they have a funeral director you trust, we&rsquo;ll invite them" />

          {error && <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{error}</p>}

          <button disabled={saving} className="button" style={{ width: '100%', marginTop: 26 }}>
            {saving ? 'Sending…' : 'Send request'}
          </button>
        </form>
      </div>
    </main>
  );
}
