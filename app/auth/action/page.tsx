'use client';
// In-app handler for Firebase Auth email actions (currently password reset).
// Firebase Console → Authentication → Templates → Password reset → "customize
// action URL" must point at https://<site>/auth/action for emails to land
// here instead of the default liveonwithme.firebaseapp.com/__/auth/action page.

import { FormEvent, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  confirmPasswordReset,
  signInWithEmailAndPassword,
  verifyPasswordResetCode,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function AuthAction() {
  return (
    <Suspense fallback={<PageSkeleton variant="form" label="Preparing" />}>
      <AuthActionInner />
    </Suspense>
  );
}

function friendlyError(code?: string, fallback?: string): string {
  const map: Record<string, string> = {
    'auth/expired-action-code': 'This link has expired. Please request a new one.',
    'auth/invalid-action-code':
      'This link is invalid or has already been used. Please request a new one.',
    'auth/user-disabled': 'This account has been disabled. Contact support.',
    'auth/user-not-found': 'We couldn\'t find that account any more.',
    'auth/weak-password': 'Please use a password of at least 6 characters.',
    'auth/network-request-failed': 'Network error. Please check your connection.',
  };
  return (code && map[code]) || fallback || 'Something went wrong. Please try again.';
}

function AuthActionInner() {
  const params = useSearchParams();
  const router = useRouter();
  const mode = params?.get('mode') || '';
  const oobCode = params?.get('oobCode') || '';
  // Firebase appends continueUrl when ActionCodeSettings.url is passed at
  // send-time. Only honour same-origin paths — never redirect off-site.
  const continueUrl = params?.get('continueUrl') || '';

  const [verifying, setVerifying] = useState(true);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode !== 'resetPassword') {
      setVerifying(false);
      return;
    }
    if (!oobCode) {
      setError('This link is missing its verification code. Please request a new one.');
      setVerifying(false);
      return;
    }
    (async () => {
      try {
        const addr = await verifyPasswordResetCode(auth, oobCode);
        setEmail(addr);
      } catch (err: any) {
        setError(friendlyError(err?.code, err?.message));
      } finally {
        setVerifying(false);
      }
    })();
  }, [mode, oobCode]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setNotice('');
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
    setSubmitting(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      // Try to sign the user straight in so they land on the dashboard without
      // a second password entry. If sign-in fails (e.g. race with a session
      // still holding an old token), fall back to the auth page.
      try {
        await signInWithEmailAndPassword(auth, email, password);
        setNotice('Password updated. Redirecting…');
        const safeNext =
          continueUrl && continueUrl.startsWith('/') && !continueUrl.startsWith('//')
            ? continueUrl
            : '/dashboard';
        router.push(safeNext);
      } catch {
        setNotice('Password updated. Please sign in with your new password.');
        router.push('/auth');
      }
    } catch (err: any) {
      setError(friendlyError(err?.code, err?.message));
    } finally {
      setSubmitting(false);
    }
  }

  if (mode && mode !== 'resetPassword') {
    return (
      <main className="shell">
        <div className="formCard">
          <div className="eyebrow">LiveOnWith.me</div>
          <h2>This link isn&rsquo;t supported yet</h2>
          <p className="muted">
            We couldn&rsquo;t handle a link of this type. If you were resetting
            your password, please start again from the sign-in page.
          </p>
          <Link href="/auth" className="button" style={{ marginTop: 20 }}>
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  if (verifying) {
    return <PageSkeleton variant="form" label="Checking your reset link" />;
  }

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">LiveOnWith.me</div>
        <h2>Choose a new password</h2>
        {email ? (
          <p className="muted">
            For <strong>{email}</strong>. Enter a new password below.
          </p>
        ) : (
          <p className="muted">
            Enter a new password below. You&rsquo;ll be signed in once it&rsquo;s set.
          </p>
        )}

        {error && !email ? (
          <>
            <p style={{ color: '#a94442', marginTop: 18, fontSize: 14 }}>{error}</p>
            <Link href="/auth" className="button secondary" style={{ marginTop: 20 }}>
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <label>New password</label>
            <input
              name="password"
              type="password"
              minLength={6}
              required
              autoComplete="new-password"
            />

            <label style={{ marginTop: 18 }}>Confirm new password</label>
            <input
              name="confirm"
              type="password"
              minLength={6}
              required
              autoComplete="new-password"
            />

            {error && (
              <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{error}</p>
            )}
            {notice && (
              <p style={{ color: '#2f5b48', marginTop: 14, fontSize: 14 }}>{notice}</p>
            )}

            <button
              className="button"
              style={{ width: '100%', marginTop: 24 }}
              disabled={submitting}
            >
              {submitting ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
