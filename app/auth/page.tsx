'use client';
import { FormEvent, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isApprovedPartner, isSuperAdminEmail } from '@/lib/roles';
import type { UserProfile } from '@/lib/types';
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

// Where to send someone once auth completes. A ?next= on the URL always wins
// (e.g. shared memorial link → sign in → land back on it). Otherwise approved
// partners get their own dashboard; everyone else goes to /dashboard.
async function destinationAfterAuth(uid: string, explicitNext: string | null): Promise<string> {
  if (explicitNext) return explicitNext;
  if (!db) return '/dashboard';
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const prof = snap.exists() ? (snap.data() as UserProfile) : null;
    return isApprovedPartner(prof) ? '/partner' : '/dashboard';
  } catch {
    return '/dashboard';
  }
}

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [emailExists, setEmailExists] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  // A quiet confirmation after a successful account deletion. The dashboard
  // sends the user here with ?deleted=1 once the server has removed them.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('deleted') === '1') {
      setNotice('Your account has been removed. Thank you.');
    }
  }, []);

  // Debounced check against /api/user/exists. Only surfaces in register mode;
  // we use the result to disable submit and offer a one-click switch to login.
  useEffect(() => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@') || trimmed.length < 5) {
      setEmailExists(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/user/exists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: trimmed }),
        });
        const data = await res.json();
        setEmailExists(!!data.exists);
      } catch {
        setEmailExists(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [email]);

  // Visitors arriving from a "start something" route almost certainly don't
  // have an account yet — default to register so we're not asking them for a
  // password they never set. Existing users can flip to login with one click.
  const [flowContext, setFlowContext] = useState<'default' | 'partner' | 'help' | 'invite'>('default');
  useEffect(() => {
    const next = nextPath();
    if (next?.startsWith('/partner/')) setFlowContext('partner');
    else if (next?.startsWith('/help/')) setFlowContext('help');
    else if (next?.startsWith('/custody/accept/')) setFlowContext('invite');
    if (
      next === '/create' ||
      next?.startsWith('/partner/') ||
      next?.startsWith('/help/') ||
      next?.startsWith('/custody/accept/')
    ) {
      setMode('register');
    }
  }, []);

  async function submitEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email')).trim();
    const password = String(fd.get('password') || '');
    const fullName = String(fd.get('fullName') || '').trim();

    try {
      if (mode === 'register') {
        if (!fullName) {
          setError('Please enter your name.');
          setLoading(false);
          return;
        }
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: fullName });
        await ensureUserProfile(cred.user.uid, cred.user.email, fullName);
        router.push(await destinationAfterAuth(cred.user.uid, nextPath()));
      } else if (mode === 'login') {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await ensureUserProfile(cred.user.uid, cred.user.email, cred.user.displayName);
        router.push(await destinationAfterAuth(cred.user.uid, nextPath()));
      } else if (mode === 'reset') {
        await fetch('/api/auth/request-reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        // Always show the same message so we don't reveal whether an account
        // exists for that email — the server behaves the same way regardless.
        setNotice(
          `If an account exists for ${email}, we've sent a reset link. Check your inbox — it can take a minute to arrive.`
        );
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
      router.push(await destinationAfterAuth(cred.user.uid, nextPath()));
    } catch (err: any) {
      setError(friendlyError(err.code, err.message));
    } finally {
      setLoading(false);
    }
  }

  const title = {
    login: 'Welcome back',
    register:
      flowContext === 'partner'
        ? 'Create your partner account'
        : flowContext === 'help'
          ? 'Sign in or create an account'
          : flowContext === 'invite'
            ? 'Create your account to continue'
            : 'Create your account',
    reset: 'Reset your password',
  }[mode];

  const subtitle = {
    login: 'Sign in to manage memorials, legacies and contributions.',
    register:
      flowContext === 'partner'
        ? 'Set up your account so you can offer LiveOnWith.me to the families you serve.'
        : flowContext === 'help'
          ? 'You\'ll need a quick account before we can look at your request.'
          : flowContext === 'invite'
            ? 'Use the email address the invitation was sent to. Already have an account? Choose "I already have an account" below.'
            : 'Your account gives you a private place to build memorials or your own legacy.',
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 1 1 0-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0 0 12.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z" />
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
            {mode === 'register' && (
              <p className="muted" style={{ fontSize: 13, textAlign: 'center', margin: '0 0 4px' }}>
                No Google account? Just use your email below — it&rsquo;s just as quick.
              </p>
            )}
          </>
        )}

        <form method="post" action="?" onSubmit={submitEmail}>
          {mode === 'register' && (
            <>
              <label>Full name</label>
              <input
                name="fullName"
                type="text"
                required
                autoComplete="name"
                placeholder="e.g. Mary O'Donnell"
              />
            </>
          )}

          <label style={mode === 'register' ? { marginTop: 18 } : undefined}>Email</label>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {mode === 'register' && emailExists && (
            <div style={{ marginTop: 8, fontSize: 14, color: '#8b6f30', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>An account with that email already exists.</span>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                  setNotice('');
                }}
                style={{ background: 'none', border: 0, padding: 0, color: 'var(--sage)', cursor: 'pointer', textDecoration: 'underline', fontSize: 14 }}
              >
                Sign in instead
              </button>
            </div>
          )}

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
              <div style={{ position: 'relative' }}>
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  minLength={6}
                  required
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  style={{ paddingRight: 60 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 0,
                    padding: 0,
                    color: 'var(--sage)',
                    fontSize: 13,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
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
            disabled={loading || (mode === 'register' && emailExists)}
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
