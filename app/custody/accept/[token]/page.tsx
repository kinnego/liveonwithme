'use client';
// Custody transfer accept page. The invitee arrives here from an email
// containing the token. They must be signed in with the email that was
// invited; if not signed in, we prompt them to sign in first.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type LoadState = 'checking_auth' | 'need_signin' | 'loading' | 'ready' | 'not_found' | 'wrong_email' | 'already_resolved' | 'error';

export default function AcceptCustody({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [state, setState] = useState<LoadState>('checking_auth');
  const [transfer, setTransfer] = useState<any>();
  const [memorial, setMemorial] = useState<any>();
  const [errorMsg, setErrorMsg] = useState('');
  const [working, setWorking] = useState<'accept' | 'decline' | null>(null);
  const [outcome, setOutcome] = useState<'accepted' | 'declined' | null>(null);
  const [token, setToken] = useState<string>('');

  useEffect(() => {
    params.then(({ token }) => {
      setToken(token);
      if (!auth) return;
      return onAuthStateChanged(auth, async (u) => {
        if (!u) {
          setState('need_signin');
          return;
        }
        setState('loading');
        try {
          const q = await getDocs(
            query(collection(db, 'custodyTransfers'), where('token', '==', token), limit(1))
          );
          if (q.empty) {
            setState('not_found');
            return;
          }
          const t = { id: q.docs[0].id, ...q.docs[0].data() } as any;
          const userEmail = (u.email || '').toLowerCase();
          if ((t.toEmail || '').toLowerCase() !== userEmail) {
            setState('wrong_email');
            setTransfer(t);
            return;
          }
          if (t.status !== 'pending') {
            setState('already_resolved');
            setTransfer(t);
            return;
          }
          const m = await getDoc(doc(db, 'memorials', t.memorialId));
          setTransfer(t);
          if (m.exists()) setMemorial({ id: m.id, ...m.data() });
          setState('ready');
        } catch (err: any) {
          setErrorMsg(err.message || 'Something went wrong loading this invitation.');
          setState('error');
        }
      });
    });
  }, [params]);

  async function respond(decision: 'accept' | 'decline') {
    if (!auth?.currentUser || !token) return;
    setWorking(decision);
    setErrorMsg('');
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/custody/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ token, decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setOutcome(data.decision);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setWorking(null);
    }
  }

  if (state === 'checking_auth' || state === 'loading') {
    return <PageSkeleton variant="compact" label="Loading invitation" />;
  }

  if (state === 'need_signin') {
    return (
      <main className="shell">
        <div className="formCard center">
          <div className="eyebrow">Custody invitation</div>
          <h2>Please sign in to continue</h2>
          <p className="muted">
            Sign in with the email address the invitation was sent to. If you don&rsquo;t have an
            account yet, that&rsquo;s fine — sign in with the same email and we&rsquo;ll create one.
          </p>
          <Link
            href={`/auth?next=${encodeURIComponent(`/custody/accept/${token}`)}`}
            className="button"
            style={{ marginTop: 20 }}
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  if (state === 'not_found') {
    return (
      <main className="shell">
        <div className="formCard center">
          <h2>We couldn&rsquo;t find that invitation</h2>
          <p className="muted">
            The link may have expired or been cancelled. If you were expecting this, please ask
            the person who sent it to try again.
          </p>
        </div>
      </main>
    );
  }

  if (state === 'wrong_email') {
    return (
      <main className="shell">
        <div className="formCard center">
          <h2>This invitation is for a different email</h2>
          <p className="muted">
            The invitation was sent to <strong>{transfer?.toEmail}</strong>. Please sign in with
            that email to continue.
          </p>
        </div>
      </main>
    );
  }

  if (state === 'already_resolved') {
    return (
      <main className="shell">
        <div className="formCard center">
          <h2>This invitation has already been {transfer?.status}</h2>
          <p className="muted">
            Nothing more to do here. If you meant to respond differently, please ask the sender
            to create a new invitation.
          </p>
        </div>
      </main>
    );
  }

  if (state === 'error') {
    return (
      <main className="shell">
        <div className="formCard center">
          <h2>Something went wrong</h2>
          <p className="muted">{errorMsg}</p>
        </div>
      </main>
    );
  }

  if (outcome === 'accepted') {
    return (
      <main className="shell">
        <div className="formCard center">
          <div className="eyebrow">Thank you</div>
          <h2>Custody accepted</h2>
          <p className="muted">
            {transfer?.nominationType === 'primary'
              ? `You are now the custodian of ${memorial?.fullName}'s memorial. It will appear in your dashboard.`
              : `You are now listed as a backup custodian for ${memorial?.fullName}'s memorial. If the primary custodian is ever unable to look after it, custody will move to you.`}
          </p>
          <Link href="/dashboard" className="button" style={{ marginTop: 20 }}>
            Go to my dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (outcome === 'declined') {
    return (
      <main className="shell">
        <div className="formCard center">
          <h2>Invitation declined</h2>
          <p className="muted">
            We&rsquo;ve let the sender know. Thank you for taking the time to respond.
          </p>
        </div>
      </main>
    );
  }

  const nominationLabel = transfer?.nominationType === 'primary' ? 'as the new custodian' : 'as a backup custodian';

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">Custody invitation</div>
        <h2>
          You&rsquo;ve been invited {nominationLabel} of {memorial?.fullName || 'a memorial'}
        </h2>
        <p className="muted">
          {transfer?.nominationType === 'primary'
            ? `Accepting means you become the person who looks after this memorial from now on. The current custodian will remain listed as a backup so they can still see it. The memorial URL stays exactly the same.`
            : `A backup custodian doesn't do anything today — but if the primary custodian is ever unable to look after the memorial, custody moves to you. It's a gentle way for a family to make sure nothing is ever lost.`}
        </p>

        <div className="card" style={{ background: '#fffdf9', marginTop: 24 }}>
          <p style={{ margin: 0 }}>
            <strong>Memorial:</strong> {memorial?.fullName || '—'}
          </p>
          <p style={{ margin: '6px 0 0' }}>
            <strong>Invited by:</strong> the current custodian
          </p>
        </div>

        {errorMsg && (
          <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{errorMsg}</p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap' }}>
          <button className="button" onClick={() => respond('accept')} disabled={working !== null}>
            {working === 'accept' ? 'Accepting…' : 'Accept'}
          </button>
          <button className="button secondary" onClick={() => respond('decline')} disabled={working !== null}>
            {working === 'decline' ? 'Declining…' : 'Decline'}
          </button>
        </div>
      </div>
    </main>
  );
}
