'use client';
import Link from 'next/link';
import ButtonLink from '@/components/ButtonLink';
import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from '@/lib/firebase-auth';
import type { Cemetery, UserProfile } from '@/lib/types';
import { isSuperAdmin } from '@/lib/roles';

// Optimistic signed-in hint. Firebase's IndexedDB-backed persistence can take
// a beat to resolve on page load — and Safari ITP sometimes wipes IndexedDB
// altogether. Without this flag we'd flash the signed-out nav for anyone who
// is actually signed in. We mirror the hint from onAuthStateChanged below.
const AUTH_HINT_KEY = 'logw.authHint';
// The graveyards a registrar looks after, kept for a few minutes so the
// menu doesn't ask the server on every page.
const GRAVEYARDS_KEY = 'logw.myGraveyards';
const GRAVEYARDS_TTL_MS = 10 * 60 * 1000;

async function loadMyGraveyards(u: User): Promise<Cemetery[]> {
  try {
    const raw = window.sessionStorage.getItem(GRAVEYARDS_KEY);
    if (raw) {
      const hit = JSON.parse(raw) as { uid: string; at: number; list: Cemetery[] };
      if (hit.uid === u.uid && Date.now() - hit.at < GRAVEYARDS_TTL_MS) return hit.list;
    }
  } catch {
    /* storage blocked or bad JSON: ask the server */
  }
  try {
    const res = await fetch('/api/registrar', { headers: { Authorization: `Bearer ${await u.getIdToken()}` } });
    const data = await res.json().catch(() => ({}));
    const list: Cemetery[] = Array.isArray(data.cemeteries) ? data.cemeteries.filter(Boolean) : [];
    try {
      window.sessionStorage.setItem(GRAVEYARDS_KEY, JSON.stringify({ uid: u.uid, at: Date.now(), list }));
    } catch {
      /* storage blocked */
    }
    return list;
  } catch {
    return [];
  }
}

export default function SiteNav() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hintSignedIn, setHintSignedIn] = useState(false);
  const [graveyards, setGraveyards] = useState<Cemetery[]>([]);
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
    let stopRefresh: () => void = () => {};
    const stopAuth = onAuthStateChanged(auth, async (u) => {
      stopRefresh();
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
      if (u) loadMyGraveyards(u).then(setGraveyards);
      else setGraveyards([]);
      if (u) {
        // Lazy-import Firestore so logged-out visitors (the vast majority
        // of public memorial traffic) never pay for the ~150 KB SDK. The
        // dynamic import runs once per sign-in; the browser caches the
        // module, so switching tabs doesn't refetch it.
        try {
          const [{ doc, getDoc }, { db }] = await Promise.all([
            import('firebase/firestore'),
            import('@/lib/firebase'),
          ]);
          if (!db) {
            setProfile(null);
            return;
          }
          const snap = await getDoc(doc(db, 'users', u.uid));
          setProfile(snap.exists() ? (snap.data() as UserProfile) : null);
          // Re-read when they come back to the tab, so a change made
          // elsewhere (such as being approved as a partner) shows up
          // without signing out and in again.
          stopRefresh();
          const refresh = () => {
            if (document.visibilityState !== 'visible') return;
            getDoc(doc(db, 'users', u.uid))
              .then((s2) => setProfile(s2.exists() ? (s2.data() as UserProfile) : null))
              .catch(() => {});
            loadMyGraveyards(u).then(setGraveyards);
          };
          document.addEventListener('visibilitychange', refresh);
          stopRefresh = () => document.removeEventListener('visibilitychange', refresh);
        } catch {
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
    });
    return () => {
      stopAuth();
      stopRefresh();
    };
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
          <ButtonLink className="button small" href="/create" onClick={closeMenu}>
            Create a page
          </ButtonLink>
        </div>
      </nav>
    );
  }

  const isPartner = profile?.role === 'partner' || isSuperAdmin(profile);
  // Someone who applied as a funeral director sees their application here
  // while it waits, so they never wonder where it went.
  const appliedPartner = !isPartner && !!profile?.partnerApplicationId;
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
        {user && (
          <span
            className="navIdentity muted"
            aria-label="Signed in as"
            title={user.email || undefined}
          >
            {profile?.displayName || user.displayName || user.email}
          </span>
        )}
        <Link href="/dashboard" onClick={closeMenu}>
          My memorials
        </Link>
        {graveyards.slice(0, 4).map((c) => (
          <Link
            key={c.placeId}
            href={`/cemetery/${encodeURIComponent(c.placeId)}/registrar?name=${encodeURIComponent(c.name)}`}
            onClick={closeMenu}
            title={`Burial register for ${c.name}`}
          >
            {graveyards.length === 1 ? 'My graveyard register' : `Register: ${c.name}`}
          </Link>
        ))}
        {(isPartner || appliedPartner) && (
          <Link href="/partner" onClick={closeMenu}>
            {appliedPartner ? 'My partner application' : 'Partner'}
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
