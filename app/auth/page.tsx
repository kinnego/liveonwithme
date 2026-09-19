'use client';
import { FormEvent, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isSuperAdminEmail } from '@/lib/roles';
import { useRouter } from 'next/navigation';

export const dynamic = 'force-dynamic';

type Mode = 'login' | 'register' | 'reset';

// Returns a same-origin path from ?next=, or null. Absolute URLs are ignored to
// prevent open-redirect abuse.
function nextPath(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('next');
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

function friendlyError(code: string, message: string): string {
  const map: Record<string, string> = {
    'auth/invalid-email': 'That email address doesn\'t look right.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/wrong-password': 'That password isn\'t right. Try again or reset it.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/email-already-in-use': 'An account with that email already exists.',
    'auth/weak-password': 'Please use a password of at least 6 characters.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
    'auth/popup-blocked': 'Your browser blocked the sign-in popup. Please allow popups and try again.',
    'auth/operation-not-allowed': 'This sign-in method isn\'t enabled yet. Contact support.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network error. Please check your connection.',
  };
  return map[code] || message;
}

async function ensureUserProfile(uid: string, email: string | null, displayName?: string | null) {
  if (!db) return;
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid,
      email: email || '',
      displayName: displayName || '',
      role: isSuperAdminEmail(email) ? 'super_admin' : 'family',
      createdAt: serverTimestamp(),
    });
  } else if (isSuperAdminEmail(email) && snap.data().role !== 'super_admin') {
    // Auto-promote the known super admin email if it was created before.
    await setDoc(ref, { role: 'super_admin' }, { merge: true });
  }
}

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // New visitors arriving from /create almost certainly don't have an account
  // yet — default to register so we're not asking them for a password they
  // never set. Existing users can flip to login with one click.
  useEffect(() => {
    const next = nextPath();
    if (next === '/create') setMode('register');
  }, []);

  async function submitEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email')).trim();
    const password = String(fd.get('password') || '');

    try {
      if (mode === 'register') {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await ensureUserProfile(cred.user.uid, cred.user.email, cred.user.displayName);
        router.push(nextPath() || '/dashboard');
      } else if (mode === 'login') {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await ensureUserProfile(cred.user.uid, cred.user.email, cred.user.displayName);
        router.push(nextPath() || '/dashboard');
      } else if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email);
        setNotice(`Password reset email sent to ${email}. Check your inbox.`);
      }
    } catch (err: any) {
      setError(friendlyError(err.code, err.message));
    } finally {
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      await ensureUserProfile(cred.user.uid, cred.user.email, cred.user.displayName);
      router.push(nextPath() || '/dashboard');
    } catch (err: any) {
      setError(friendlyError(err.code, err.message));
    } finally {
      setLoading(false);
    }
  }

  const title = {
    login: 'Welcome back',
    register: 'Create your account',
    reset: 'Reset your password',
  }[mode];

  const subtitle = {
    login: 'Sign in to manage memorials, legacies and contributions.',
    register: 'Your account gives you a private place to build memorials or your own legacy.',
    reset: 'Enter your email and we\'ll send you a reset link.',
  }[mode];

  const primaryLabel = {
    login: 'Sign in',
    register: 'Create account',
    reset: 'Send reset link',
  }[mode];

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">LiveOnWith.me</div>
        <h2>{title}</h2>
        <p className="muted">{subtitle}</p>

        {mode !== 'reset' && (
          <>
            <button
              type="button"
              className="button secondary"
              style={{
                width: '100%',
                marginTop: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
              onClick={signInWithGoogle}
              disabled={loading}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
                  fill="#4285F4"
                />
                <path
                  d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
                  fill="#34A853"
                />
                <path
                  d="M3.964 10.705A5.41 5.41 0 0 1 3.682 9c0-.591.102-1.166.282-1.705V4.963H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.037l3.007-2.332z"
                  fill="#FBBC05"
                />
                <path
                  d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.963L3.964 7.295C4.672 5.168 6.656 3.58 9 3.58z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </button>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                margin: '20px 0 8px',
                color: 'var(--muted)',
                fontSize: 13,
              }}
            >
              <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              or
              <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            </div>
          </>
        )}

        <form method="post" action="?" onSubmit={submitEmail}>
          <label>Email</label>
          <input name="email" type="email" required autoComplete="email" />

          {mode !== 'reset' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 18 }}>
                <label style={{ margin: 0 }}>Password</label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setError('');
                      setNotice('');
                    }}
                    style={{
                      background: 'none',
                      border: 0,
                      padding: 0,
                      color: 'var(--sage)',
                      fontSize: 13,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                name="password"
                type="password"
                minLength={6}
                required
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              />
            </>
          )}

          {error && (
            <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{error}</p>
          )}
          {notice && (
            <p style={{ color: '#2f5b48', marginTop: 14, fontSize: 14 }}>{notice}</p>
          )}

          <button
            className="button"
            style={{ width: '100%', marginTop: 24 }}
            disabled={loading}
          >
            {loading ? 'Working…' : primaryLabel}
          </button>
        </form>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 20,
            marginTop: 24,
            fontSize: 14,
            flexWrap: 'wrap',
          }}
        >
          {mode === 'login' && (
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
                setNotice('');
              }}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--ink)', textDecoration: 'underline' }}
            >
              Create an account
            </button>
          )}
          {mode === 'register' && (
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
                setNotice('');
              }}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--ink)', textDecoration: 'underline' }}
            >
              I already have an account
            </button>
          )}
          {mode === 'reset' && (
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
                setNotice('');
              }}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--ink)', textDecoration: 'underline' }}
            >
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
