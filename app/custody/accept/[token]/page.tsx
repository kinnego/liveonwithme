'use client';
// Custody transfer accept page. The invitee arrives here from an email
// or copied link. We load invite details via a server endpoint (admin
// SDK) so an invitee signed in with the wrong email sees a helpful
// mismatch screen instead of a raw Firebase permission-denied error.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type Invite = {
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  nominationType: 'primary' | 'backup' | 'coManager';
  toEmail: string;
  memorial: { id: string; fullName: string };
};

export default function AcceptCustody({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [token, setToken] = useState('');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [working, setWorking] = useState<'accept' | 'decline' | null>(null);
  const [outcome, setOutcome] = useState<'accepted' | 'declined' | null>(null);

  useEffect(() => {
    params.then(async ({ token }) => {
      setToken(token);
      try {
        const res = await fetch('/api/custody/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) {
          setLoadError(data.error || 'Something went wrong loading this invitation.');
          return;
        }
        if (!data.found) {
          setNotFound(true);
          return;
        }
        setInvite({
          status: data.status,
          nominationType: data.nominationType,
          toEmail: data.toEmail,
          memorial: data.memorial,
        });
      } catch (err: any) {
        setLoadError(err.message || 'Something went wrong loading this invitation.');
      }
    });
  }, [params]);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, []);

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

  if (loadError) {
    return (
      <main className="shell">
        <div className="formCard center">
          <h2>Something went wrong</h2>
          <p className="muted">{loadError}</p>
        </div>
      </main>
    );
  }

  if (notFound) {
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

  if (!invite || !authReady) {
    return <PageSkeleton variant="compact" label="Loading invitation" />;
  }

  if (invite.status !== 'pending') {
    return (
      <main className="shell">
        <div className="formCard center">
          <h2>This invitation has already been {invite.status}</h2>
          <p className="muted">
            Nothing more to do here. If you meant to respond differently, please ask the sender
            to create a new invitation.
          </p>
        </div>
      </main>
    );
  }

  if (outcome === 'accepted') {
    const acceptedCopy =
      invite.nominationType === 'primary'
        ? `You are now the custodian of ${invite.memorial.fullName}'s memorial. It will appear in your dashboard.`
        : invite.nominationType === 'coManager'
          ? `You can now help manage ${invite.memorial.fullName}'s memorial — approving memories, adding photos, and editing the story. It will appear in your dashboard.`
          : `You are now listed as a backup custodian for ${invite.memorial.fullName}'s memorial. If the primary custodian is ever unable to look after it, custody will move to you.`;
    return (
      <main className="shell">
        <div className="formCard center">
          <div className="eyebrow">Thank you</div>
          <h2>{invite.nominationType === 'coManager' ? 'Invitation accepted' : 'Custody accepted'}</h2>
          <p className="muted">{acceptedCopy}</p>
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

  const nominationLabel =
    invite.nominationType === 'primary'
      ? 'as the new custodian of'
      : invite.nominationType === 'coManager'
        ? 'to help manage'
        : 'as a backup custodian of';
  const eyebrow = invite.nominationType === 'coManager' ? 'Co-manager invitation' : 'Custody invitation';
  const bodyCopy =
    invite.nominationType === 'primary'
      ? `Accepting means you become the person who looks after this memorial from now on. The current custodian will remain listed as a backup so they can still see it. The memorial URL stays exactly the same.`
      : invite.nominationType === 'coManager'
        ? `You'll be able to approve memories, add photos, and edit the story alongside the current custodian. You can't transfer custody or delete the memorial — those stay with the owner.`
        : `A backup custodian doesn't do anything today — but if the primary custodian is ever unable to look after the memorial, custody moves to you. It's a gentle way for a family to make sure nothing is ever lost.`;

  const userEmail = (user?.email || '').toLowerCase();
  const inviteEmail = (invite.toEmail || '').toLowerCase();
  const emailMatches = !!user && userEmail === inviteEmail;

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">{eyebrow}</div>
        <h2>
          You&rsquo;ve been invited {nominationLabel} {invite.memorial.fullName || 'a memorial'}
        </h2>
        <p className="muted">{bodyCopy}</p>

        <div className="card" style={{ background: '#fffdf9', marginTop: 24 }}>
          <p style={{ margin: 0 }}>
            <strong>Memorial:</strong> {invite.memorial.fullName || '—'}
          </p>
          <p style={{ margin: '6px 0 0' }}>
            <strong>Invited:</strong> {invite.toEmail}
          </p>
        </div>

        {!user && (
          <div style={{ marginTop: 26, padding: '16px 20px', background: '#fff8e8', border: '1px solid #e0c890', borderRadius: 12 }}>
            <p style={{ margin: 0, fontSize: 15 }}>
              <strong>Please sign in to continue.</strong> Use <strong>{invite.toEmail}</strong>
              {' '}so we can match this invitation to you. If you don&rsquo;t have a
              LiveOnWith.me account yet, we&rsquo;ll create one.
            </p>
            <Link
              href={`/auth?next=${encodeURIComponent(`/custody/accept/${token}`)}`}
              className="button"
              style={{ marginTop: 14 }}
            >
              Create account or sign in
            </Link>
          </div>
        )}

        {user && !emailMatches && (
          <div style={{ marginTop: 26, padding: '16px 20px', background: '#fff1ec', border: '1px solid #e0a890', borderRadius: 12 }}>
            <p style={{ margin: 0, fontSize: 15 }}>
              <strong>You&rsquo;re signed in as {user.email}.</strong> This invitation was sent to{' '}
              <strong>{invite.toEmail}</strong>. Please sign out and sign in with that email to accept.
            </p>
            <button
              className="button secondary"
              style={{ marginTop: 14 }}
              onClick={() => auth?.signOut()}
            >
              Sign out
            </button>
          </div>
        )}

        {errorMsg && (
          <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{errorMsg}</p>
        )}

        {emailMatches && (
          <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap' }}>
            <button className="button" onClick={() => respond('accept')} disabled={working !== null}>
              {working === 'accept' ? 'Accepting…' : 'Accept'}
            </button>
            <button className="button secondary" onClick={() => respond('decline')} disabled={working !== null}>
              {working === 'decline' ? 'Declining…' : 'Decline'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
