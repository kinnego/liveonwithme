'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  EmailAuthProvider,
  linkWithCredential,
  signInWithCustomToken,
  updatePassword,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type Phase = 'verifying' | 'setPassword' | 'error';

export default function Claim({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState('');
  const [status, setStatus] = useState<Phase>('verifying');
  const [error, setError] = useState('');
  const [pendingMemorialSlug, setPendingMemorialSlug] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  async function submitPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auth.currentUser) return;
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get('password') || '');
    const confirm = String(fd.get('confirm') || '');
    if (password.length < 6) {
      setError('Please use a password of at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords don\'t match.');
      return;
    }
    setError('');
    setPasswordSaving(true);
    try {
      const email = auth.currentUser.email;
      if (!email) throw new Error('No email on this account.');
      try {
        const cred = EmailAuthProvider.credential(email, password);
        await linkWithCredential(auth.currentUser, cred);
      } catch (err: any) {
        if (err?.code === 'auth/provider-already-linked' || err?.code === 'auth/credential-already-in-use') {
          await updatePassword(auth.currentUser, password);
        } else {
          throw err;
        }
      }
      router.push(`/memorial/${pendingMemorialSlug}/manage`);
    } catch (err: any) {
      setError(err.message || 'Could not save your password.');
      setPasswordSaving(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    if (!token) {
      setError(
        "This invite link is missing its verification token. Please contact the person who sent it to you for a new invite."
      );
      setStatus('error');
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/claim/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "This invite link isn't valid or has expired.");
          setStatus('error');
          return;
        }
        await signInWithCustomToken(auth, data.customToken);
        const slug = data.memorialSlug as string;
        setPendingMemorialSlug(slug);
        if (data.needsPasswordSetup) {
          setStatus('setPassword');
        } else {
          router.push(`/memorial/${slug}/manage`);
        }
      } catch (err: any) {
        setError(err.message || 'Something went wrong.');
        setStatus('error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  if (status === 'error')
    return (
      <main className="shell">
        <div className="card">
          <h3>We couldn&rsquo;t open this invite</h3>
          <p className="muted">{error}</p>
        </div>
      </main>
    );

  if (status === 'setPassword')
    return (
      <main className="shell">
        <div className="formCard">
          <div className="eyebrow">One last step</div>
          <h2>Choose a password</h2>
          <p className="muted">
            You&rsquo;ll need this to sign back in later and keep looking after the memorial.
            {auth.currentUser?.email && (
              <> Your email is <strong>{auth.currentUser.email}</strong>.</>
            )}
          </p>
          <form onSubmit={submitPassword}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              minLength={6}
              required
              autoComplete="new-password"
            />
            <label htmlFor="confirm" style={{ marginTop: 18 }}>Confirm password</label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              minLength={6}
              required
              autoComplete="new-password"
            />
            {error && (
              <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{error}</p>
            )}
            <button
              className="button"
              style={{ width: '100%', marginTop: 24 }}
              disabled={passwordSaving}
            >
              {passwordSaving ? 'Saving…' : 'Save & continue to the memorial'}
            </button>
          </form>
        </div>
      </main>
    );

  return <PageSkeleton variant="compact" label="Setting up the memorial page" />;
}
