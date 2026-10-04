'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { UserProfile } from '@/lib/types';
import { isSuperAdmin } from '@/lib/roles';

// Optimistic signed-in hint. Firebase's IndexedDB-backed persistence can take
// a beat to resolve on page load — and Safari ITP sometimes wipes IndexedDB
// altogether. Without this flag we'd flash the signed-out nav for anyone who
// is actually signed in. We mirror the hint from onAuthStateChanged below.
const AUTH_HINT_KEY = 'logw.authHint';

export default function SiteNav() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hintSignedIn, setHintSignedIn] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        if (window.localStorage.getItem(AUTH_HINT_KEY) === '1') setHintSignedIn(true);
      } catch {
        /* storage blocked — fall through to the unknown state */
      }
    }
    if (!auth) {
      setUser(null);
      return;
    }
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (typeof window !== 'undefined') {
        try {
          if (u) window.localStorage.setItem(AUTH_HINT_KEY, '1');
          else window.localStorage.removeItem(AUTH_HINT_KEY);
        } catch {
          /* storage blocked */
        }
      }
      setHintSignedIn(!!u);
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

  const closeMenu = () => setMenuOpen(false);

  // Three-way: user === undefined means Firebase hasn't resolved yet. If we
  // have a hint from a prior session we optimistically render the signed-in
  // shell so the sign-in/create buttons don't flash. Only render the
  // signed-out nav once Firebase has definitively said user === null.
  if (user === undefined && !hintSignedIn) {
    return <nav aria-hidden style={{ minHeight: 40 }} />;
  }

  if (user === null) {
    // Signed-out nav uses the same burger shell as signed-in. On mobile the
    // CTAs hide inside the drawer so they don't dominate every page header;
    // on desktop the media query lets them show inline as usual.
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
          <Link href="/auth" onClick={closeMenu}>
            Sign in
          </Link>
          <Link className="button small" href="/create" onClick={closeMenu}>
            Create a page
          </Link>
        </div>
      </nav>
    );
  }

  const showPartner = profile?.role === 'partner' || isSuperAdmin(profile);
  const showAdmin = isSuperAdmin(profile);

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
