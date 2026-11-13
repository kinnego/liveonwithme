'use client';
// Funeral director's quick add: put someone who has died into a cemetery's
// register, without starting a memorial. Starting a memorial is a separate
// choice on the partner page (/partner/new).
import { FormEvent, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import type { Cemetery, UserProfile } from '@/lib/types';
import { isApprovedPartner, isSuperAdmin } from '@/lib/roles';
import { FAMILY_CONTACT_CONSENT_TEXT } from '@/lib/family-contact';
import CemeteryPicker from '@/components/CemeteryPicker';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type Done = {
  outcome: 'added_to_grave' | 'new_grave' | 'already_there';
  personName: string;
  graveId: string;
  cemeteryName: string;
};

const EMPTY = {
  forenames: '',
  surname: '',
  died: '',
  age: '',
  address: '',
  section: '',
  row: '',
  plotNumber: '',
  familyName: '',
  familyEmail: '',
};

export default function PartnerRegisterPage() {
  const router = useRouter();
  const [ok, setOk] = useState<boolean | null>(null);
  const [cemetery, setCemetery] = useState<Cemetery | null>(null);
  const [f, setF] = useState(EMPTY);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return router.push('/auth');
      const snap = await getDoc(doc(db, 'users', u.uid));
      const prof = snap.exists() ? (snap.data() as UserProfile) : null;
      setOk(isSuperAdmin(prof) || isApprovedPartner(prof));
    });
  }, [router]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!cemetery) {
      setError('Please choose the cemetery first.');
      return;
    }
    if (!f.surname.trim()) {
      setError('Please put in their surname.');
      return;
    }
    if (!auth.currentUser) return;
    setSaving(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/partner/burials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cemetery, ...f, familyConsent: consent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
      setDone({ ...data, cemeteryName: cemetery.name });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // Keep the cemetery: the next person is often for the same one.
  function addAnother() {
    setF(EMPTY);
    setConsent(false);
    setDone(null);
    setError('');
    window.scrollTo({ top: 0 });
  }

  if (ok === null) return <PageSkeleton variant="form" label="Checking your access" />;

  if (!ok) {
    return (
      <main className="shell">
        <div className="formCard">
          <div className="eyebrow">Partner access needed</div>
          <h2>This page is for approved funeral directors.</h2>
          <p className="muted">
            If you&rsquo;re a funeral director, apply to become a partner and we&rsquo;ll get back to you within
            a working day.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <a href="/partner/apply" className="button">Apply</a>
            <a href="/dashboard" className="button secondary">Go to my dashboard</a>
          </div>
        </div>
      </main>
    );
  }

  if (done) {
    const heading =
      done.outcome === 'already_there'
        ? `${done.personName} is already in that grave.`
        : `${done.personName} is now in the register.`;
    const detail =
      done.outcome === 'added_to_grave'
        ? `We added them to the grave already listed at that plot in ${done.cemeteryName}.`
        : done.outcome === 'new_grave'
          ? `We added a new grave for them in ${done.cemeteryName}.`
          : `Nothing has changed in ${done.cemeteryName}.`;
    return (
      <main className="shell">
        <div className="formCard">
          <div className="eyebrow">Saved</div>
          <h2>{heading}</h2>
          <p className="muted">{detail} Families can now find them when they search the cemetery.</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
            <button type="button" className="button" onClick={addAnother}>Add another person</button>
            <a href={`/grave/${done.graveId}`} className="button secondary">See the grave</a>
            <a href="/partner" className="button secondary">Back to partner page</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div style={{ maxWidth: 690, margin: '0 auto 10px' }}>
        <a href="/partner" className="button secondary small">Partner page</a>
      </div>
      <div className="formCard">
        <div className="eyebrow">Cemetery register</div>
        <h2>Add someone to a cemetery register.</h2>
        <p className="muted">
          This puts their name in the cemetery&rsquo;s list of graves, so families can find them. It
          doesn&rsquo;t start a memorial and there&rsquo;s nothing to pay.
        </p>
        <form onSubmit={submit} noValidate>
          <h3 style={{ marginTop: 26 }}>Which cemetery?</h3>
          <CemeteryPicker value={cemetery} onChange={setCemetery} />

          <h3 style={{ marginTop: 30 }}>The person who has died</h3>
          <div className="twoCol">
            <div>
              <label htmlFor="forenames">First names</label>
              <input id="forenames" value={f.forenames} onChange={set('forenames')} autoComplete="off" />
            </div>
            <div>
              <label htmlFor="surname">Surname</label>
              <input id="surname" value={f.surname} onChange={set('surname')} autoComplete="off" required />
            </div>
          </div>
          <div className="twoCol">
            <div>
              <label htmlFor="died">Date they died</label>
              <input id="died" type="date" value={f.died} onChange={set('died')} />
            </div>
            <div>
              <label htmlFor="age">Age</label>
              <input id="age" inputMode="numeric" value={f.age} onChange={set('age')} />
            </div>
          </div>
          <label htmlFor="address">Where they lived</label>
          <input id="address" value={f.address} onChange={set('address')} placeholder="e.g. Main Street, Carndonagh" />

          <h3 style={{ marginTop: 30 }}>The grave</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            Fill in what you know. If the plot is already in the register, we&rsquo;ll add them to that
            grave. If you leave these empty, we&rsquo;ll add a new grave.
          </p>
          <div className="twoCol">
            <div>
              <label htmlFor="section">Section</label>
              <input id="section" value={f.section} onChange={set('section')} />
            </div>
            <div>
              <label htmlFor="row">Row</label>
              <input id="row" value={f.row} onChange={set('row')} />
            </div>
          </div>
          <label htmlFor="plotNumber">Plot number</label>
          <input id="plotNumber" value={f.plotNumber} onChange={set('plotNumber')} />

          <h3 style={{ marginTop: 30 }}>Family contact</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            Optional. This is private. It is never shown on the site.
          </p>
          <label htmlFor="familyName">Their name</label>
          <input id="familyName" value={f.familyName} onChange={set('familyName')} autoComplete="off" />
          <label htmlFor="familyEmail">Their email</label>
          <input
            id="familyEmail"
            type="email"
            value={f.familyEmail}
            onChange={set('familyEmail')}
            autoComplete="off"
          />
          {f.familyEmail.trim() && (
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 500, fontSize: 15 }}>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                style={{ width: 22, height: 22, flex: '0 0 22px', marginTop: 2 }}
              />
              <span>{FAMILY_CONTACT_CONSENT_TEXT} Only tick this if you&rsquo;ve asked them.</span>
            </label>
          )}

          {error && (
            <p role="alert" style={{ color: '#a94442', marginTop: 16, fontSize: 15 }}>
              {error}
            </p>
          )}

          <button disabled={saving} className="button" style={{ width: '100%', marginTop: 26 }}>
            {saving ? 'Saving…' : 'Add to the register'}
          </button>
        </form>
      </div>
    </main>
  );
}
