'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export default function SiteNav() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    if (!auth) {
      setUser(null);
      return;
    }
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  if (user === undefined) {
    return <nav aria-hidden style={{ minHeight: 40 }} />;
  }

  if (!user) {
    return (
      <nav>
        <Link href="/auth">Sign in</Link>
        <Link className="button small" href="/create">
          Create a memorial
        </Link>
      </nav>
    );
  }

  return (
    <nav>
      <Link href="/dashboard">Dashboard</Link>
      <button
        type="button"
        className="button small secondary"
        onClick={() => signOut(auth)}
      >
        Sign out
      </button>
    </nav>
  );
}
