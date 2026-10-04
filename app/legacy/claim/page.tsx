'use client';
// Public landing for someone who has been given a one-time claim code for a
// self-managed page. The code itself is the gate — once entered and matched
// server-side, custody transfers immediately. No cooldown, no verification.
// The owner is expected to have printed the code and stored it carefully
// (with their will, in a safe) and shared it only with the person they want
// to inherit the page.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { formatLegacyCode, normalizeLegacyCode } from '@/lib/legacy-code';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function LegacyClaim() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [code, setCode] = useState('');
  const [working, setWorking] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const router = useRouter();

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth?.currentUser) return;
    const canonical = normalizeLegacyCode(code);
    if (canonical.length < 16) {
      setErrorMsg('Please enter the full claim code from the letter.');
      return;
    }
    setWorking(true);
    setErrorMsg('');
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/legacy/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ code: canonical }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      router.push(`/memorial/${data.memorialId}/manage`);
    } catch (err: any) {
      setErrorMsg(err.message);
      setWorking(false);
    }
  }

  if (!authReady) {
    return <PageSkeleton variant="compact" label="Preparing" />;
  }

  if (!user) {
    return (
      <main className="shell">
        <div className="formCard">
          <div className="eyebrow">Claim a page</div>
          <h2>Please sign in to continue</h2>
          <p className="muted">
            You&rsquo;ll need a LiveOnWith.me account to claim a page. If you don&rsquo;t
            have one yet, we&rsquo;ll create it in a moment — no cost.
          </p>
          <Link
            href={`/auth?next=${encodeURIComponent('/legacy/claim')}`}
            className="button"
            style={{ marginTop: 18 }}
          >
            Sign in or create account
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">Claim a page</div>
        <h2>Enter the claim code</h2>
        <p className="muted">
          If someone close to you set up a LiveOnWith.me page for themselves and gave you
          a printed claim code, enter it below. Doing this moves custody of the page to
          you so you can look after it from here on.
        </p>

        <form onSubmit={submit} style={{ marginTop: 22 }}>
          <label htmlFor="code">Claim code</label>
          <input
            id="code"
            type="text"
            value={code}
            onChange={(e) => setCode(formatLegacyCode(normalizeLegacyCode(e.target.value)))}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              letterSpacing: '0.08em',
              fontSize: 16,
            }}
          />
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            Signed in as <strong>{user.email}</strong>.
          </p>

          {errorMsg && (
            <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{errorMsg}</p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <button className="button" type="submit" disabled={working}>
              {working ? 'Claiming\u2026' : 'Claim the page'}
            </button>
            <Link href="/dashboard" className="button secondary">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
