'use client';
import Link from 'next/link';
import ButtonLink from '@/components/ButtonLink';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from '@/lib/firebase-auth';
import type { Cemetery, UserProfile } from '@/lib/types';
import { isSuperAdmin } from '@/lib/roles';

// Optimistic signed-in hint. Firebase's IndexedDB-backed persistence can take
// a beat to resolve on page load — and Safari ITP sometimes wipes IndexedDB
// altogether. Without this flag we'd flash the signed-out nav for anyone who
// is actually signed in. We mirror the hint from onAuthStateChanged below.
const AUTH_HINT_KEY = 'logw.authHint';
// Ask for the menu's graveyards again, e.g. right after joining as a
// registrar: window.dispatchEvent(new Event(GRAVEYARDS_CHANGED)).
export const GRAVEYARDS_CHANGED = 'logw:graveyards-changed';

// Always asked fresh, so becoming (or stopping being) a registrar shows in
// the menu straight away.
async function loadMyGraveyards(u: User): Promise<Cemetery[]> {
  try {
    const res = await fetch('/api/registrar', {
      headers: { Authorization: `Bearer ${await u.getIdToken()}` },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data.cemeteries) ? data.cemeteries.filter(Boolean) : [];
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
  const router = useRouter();

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
      stopRefresh = () => {};
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
          const [{ doc, onSnapshot }, { db }] = await Promise.all([
            import('firebase/firestore'),
            import('@/lib/firebase'),
          ]);
          if (!db) {
            setProfile(null);
            return;
          }
          // Live: when their role changes (approved as a partner, made an
          // admin), the menu updates at once, with no reload or sign-out.
          const stopProfile = onSnapshot(
            doc(db, 'users', u.uid),
            (snap) => setProfile(snap.exists() ? (snap.data() as UserProfile) : null),
            () => setProfile(null),
          );
          // Registrar access lives on the server, so ask again when they come
          // back to the tab or a page says it changed.
          const refreshGraveyards = () => {
            if (document.visibilityState === 'visible') loadMyGraveyards(u).then(setGraveyards);
          };
          document.addEventListener('visibilitychange', refreshGraveyards);
          window.addEventListener(GRAVEYARDS_CHANGED, refreshGraveyards);
          stopRefresh = () => {
            stopProfile();
            document.removeEventListener('visibilitychange', refreshGraveyards);
            window.removeEventListener(GRAVEYARDS_CHANGED, refreshGraveyards);
          };
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
          onClick={async () => {
            closeMenu();
            await signOut(auth);
            router.push('/auth?signedOut=1');
          }}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
