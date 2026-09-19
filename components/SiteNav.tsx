'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { UserProfile } from '@/lib/types';
import { isSuperAdmin } from '@/lib/roles';

export default function SiteNav() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!auth) {
      setUser(null);
      return;
    }
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u && db) {
        try {
          const snap = await getDoc(doc(db, 'users', u.uid));
          setProfile(snap.exists() ? (snap.data() as UserProfile) : null);
        } catch {
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
    });
  }, []);

  if (user === undefined) {
    return <nav aria-hidden style={{ minHeight: 40 }} />;
  }

  if (!user) {
    return (
      <nav>
        <Link href="/auth">Sign in</Link>
        <Link className="button small" href="/create">
          Create a page
        </Link>
      </nav>
    );
  }

  const showPartner = profile?.role === 'partner' || isSuperAdmin(profile);
  const showAdmin = isSuperAdmin(profile);

  return (
    <nav>
      <Link href="/dashboard">Dashboard</Link>
      {showPartner && <Link href="/partner">Partner</Link>}
      {showAdmin && <Link href="/admin">Admin</Link>}
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
