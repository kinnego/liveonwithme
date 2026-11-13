'use client';
// The header logo. Approved partners (and the super admin, who runs the
// partner side too) go to their partner page; everyone else to the home page.
// The partner page itself has a "Home page" button for the public site.
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isApprovedPartner } from '@/lib/roles';
import type { UserProfile } from '@/lib/types';

export default function BrandLink({ children }: { children: ReactNode }) {
  const [href, setHref] = useState('/');

  useEffect(() => {
    if (!auth || !db) return;
    let stopProfile: (() => void) | undefined;
    const off = onAuthStateChanged(auth, (u) => {
      stopProfile?.();
      stopProfile = undefined;
      if (!u) {
        setHref('/');
        return;
      }
      stopProfile = onSnapshot(
        doc(db, 'users', u.uid),
        (snap) => {
          const prof = snap.exists() ? (snap.data() as UserProfile) : null;
          setHref(isApprovedPartner(prof) ? '/partner' : '/');
        },
        () => setHref('/'),
      );
    });
    return () => {
      off();
      stopProfile?.();
    };
  }, []);

  return (
    <Link className="brand" href={href}>
      {children}
    </Link>
  );
}
