'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { UserProfile } from '@/lib/types';
import { isSuperAdmin } from '@/lib/roles';

export default function SiteNav() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

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

  // Close the mobile drawer when tapping outside the nav, so it feels like a
  // native menu rather than a sticky panel.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!navRef.current) return;
      if (!navRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  if (user === undefined) {
    return <nav aria-hidden style={{ minHeight: 40 }} />;
  }

  if (!user) {
    return (
      <nav>
        <div className="navLinks" style={{ display: 'flex' }}>
          <Link href="/auth">Sign in</Link>
          <Link className="button small" href="/create">
            Create a page
          </Link>
        </div>
      </nav>
    );
  }

  const showPartner = profile?.role === 'partner' || isSuperAdmin(profile);
  const showAdmin = isSuperAdmin(profile);
  const closeMenu = () => setMenuOpen(false);

  return (
    <nav ref={navRef}>
      <button
        type="button"
        className="navBurger"
        aria-expanded={menuOpen}
        aria-controls="site-nav-menu"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {menuOpen ? '\u2715' : '\u2630'}
      </button>
      <div id="site-nav-menu" className={`navLinks${menuOpen ? ' open' : ''}`}>
        <Link href="/dashboard" onClick={closeMenu}>
          My memorials
        </Link>
        {showPartner && (
          <Link href="/partner" onClick={closeMenu}>
            Partner
          </Link>
        )}
        {showAdmin && (
          <Link href="/admin" onClick={closeMenu}>
            Admin
          </Link>
        )}
        <button
          type="button"
          className="button small secondary"
          onClick={() => {
            closeMenu();
            signOut(auth);
          }}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
