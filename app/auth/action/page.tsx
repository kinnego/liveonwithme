'use client';
// Handles password-reset links emailed by our own /api/auth/request-reset flow.
// The link carries a first-party token in ?token=, verified server-side by
// /api/auth/confirm-reset. Firebase's oobCode flow is no longer used here.

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
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

function AuthActionInner() {
  const params = useSearchParams();
  const router = useRouter();
  const mode = params?.get('mode') || '';
  const token = params?.get('token') || '';
  // Same-origin continueUrl support kept for parity with the previous flow.
  const continueUrl = params?.get('continueUrl') || '';

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      const res = await fetch('/api/auth/confirm-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not update your password.');
        setSubmitting(false);
        return;
      }
      // Try to sign the user straight in so they land on the dashboard without
      // a second password entry. If sign-in fails, fall back to /auth.
      try {
        await signInWithEmailAndPassword(auth, data.email, password);
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
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  if (!mode) {
    return (
      <main className="shell">
        <div className="formCard">
          <div className="eyebrow">LiveOnWith.me</div>
          <h2>Nothing to do here</h2>
          <p className="muted">
            This page opens the reset link from a &ldquo;forgot your password&rdquo; email.
            If you were trying to reset your password, request a fresh link from the sign-in
            page.
          </p>
          <Link href="/auth" className="button" style={{ marginTop: 20 }}>
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  if (mode !== 'resetPassword') {
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

  if (!token) {
    return (
      <main className="shell">
        <div className="formCard">
          <div className="eyebrow">LiveOnWith.me</div>
          <h2>This link is missing something</h2>
          <p className="muted">
            The reset link didn&rsquo;t include a verification token. Please request a
            fresh link from the sign-in page.
          </p>
          <Link href="/auth" className="button" style={{ marginTop: 20 }}>
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">LiveOnWith.me</div>
        <h2>Choose a new password</h2>
        <p className="muted">
          Enter a new password below. You&rsquo;ll be signed in once it&rsquo;s set.
        </p>

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
      </div>
    </main>
  );
}
