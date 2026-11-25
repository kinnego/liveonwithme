'use client';

// "Your public page" section on /partner. Summary card: shows the URL,
// Live/Hidden switch, copy-link, and QR download. Actual editing of
// business name, blurb, and contact details happens on the public page
// itself via /partner/<slug>?edit=1 so the partner sees what visitors see.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import { UserProfile } from '@/lib/types';
import QRCode from 'qrcode';

type Props = {
  uid: string;
  profile: UserProfile;
};

const SITE_URL =
  (typeof window !== 'undefined' ? window.location.origin : null) ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'https://liveonwith.me';

export default function PartnerPublicPageCard({ uid, profile }: Props) {
  const [slug, setSlug] = useState(profile.partnerSlug || '');
  const [claimingSlug, setClaimingSlug] = useState(false);
  const [showPublicly, setShowPublicly] = useState(profile.partnerPublic !== false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Backfill a slug for partners approved before this feature shipped (and
  // for any approval where the admin-side slug call failed silently).
  const backfilled = useRef(false);
  useEffect(() => {
    if (backfilled.current) return;
    if (profile.partnerSlug) return;
    const eligible =
      (profile.role === 'partner' && profile.partnerStatus === 'approved') ||
      isSuperAdmin(profile);
    if (!eligible) return;
    backfilled.current = true;
    (async () => {
      try {
        setClaimingSlug(true);
        const token = await auth?.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch('/api/partner/slug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            targetUid: uid,
            fallbackFromName: profile.partnerBusinessName || '',
          }),
        });
        const data = await res.json();
        if (res.ok && data.slug) {
          setSlug(data.slug);
        }
      } finally {
        setClaimingSlug(false);
      }
    })();
  }, [profile]);

  const publicUrl = slug ? `${SITE_URL}/partner/${slug}` : '';

  async function copyUrl() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  async function downloadQr() {
    if (!publicUrl) return;
    try {
      // SVG so a printer can scale the poster to any size without blurring.
      const svg = await QRCode.toString(publicUrl, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
      });
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug || 'partner'}-qr.svg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Could not generate QR');
    }
  }

  async function togglePublic(next: boolean) {
    setShowPublicly(next);
    try {
      await updateDoc(doc(db, 'users', uid), { partnerPublic: next });
    } catch (err: any) {
      setShowPublicly(!next);
      setError(err.message || 'Could not update');
    }
  }

  const summaryText = useMemo(() => {
    if (!slug) return claimingSlug ? 'Setting up your public page…' : 'No public page yet.';
    return publicUrl;
  }, [slug, publicUrl, claimingSlug]);

  return (
    <div className="card" style={{ marginBottom: 30 }}>
      <div className="publicPageHeader">
        <div>
          <h3 style={{ margin: 0 }}>Your public page</h3>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 14, maxWidth: 480 }}>
            A ready-made page you can share — on your own website, on a card, or as a QR on
            your premises. Families scan it and start a memorial with you already attached.
          </p>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showPublicly}
            onChange={(e) => togglePublic(e.target.checked)}
          />
          <span className="toggleTrack" aria-hidden="true" />
          <span>{showPublicly ? 'Live' : 'Hidden'}</span>
        </label>
      </div>

      <div style={{ marginTop: 18 }}>
        {slug ? (
          <a className="publicPageUrl" href={publicUrl} target="_blank" rel="noreferrer">
            {publicUrl}
          </a>
        ) : (
          <span className="muted" style={{ fontSize: 14 }}>{summaryText}</span>
        )}
      </div>

      <div className="publicPageShareGrid">
        <div className="publicPageShareCell">
          <div className="eyebrow" style={{ marginBottom: 6 }}>Share online</div>
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
            Paste the link into your website, emails, or social posts.
          </p>
          <button
            type="button"
            className="button secondary small"
            onClick={copyUrl}
            disabled={!slug}
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
        <div className="publicPageShareCell">
          <div className="eyebrow" style={{ marginBottom: 6 }}>Print for your shop</div>
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
            A sharp SVG for a window sticker, business card, or counter sign.
          </p>
          <button
            type="button"
            className="button secondary small"
            onClick={downloadQr}
            disabled={!slug}
          >
            Download QR code
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        {slug && showPublicly ? (
          <Link
            href={`/partner/${slug}?edit=1`}
            className="button secondary small"
          >
            Preview &amp; edit
          </Link>
        ) : (
          <span
            className="button secondary small"
            aria-disabled="true"
            style={{ opacity: 0.4, cursor: 'not-allowed' }}
            title={slug ? 'Go live to preview your page.' : 'Setting up your URL…'}
          >
            Preview &amp; edit
          </span>
        )}
      </div>

      {!showPublicly && slug && (
        <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>
          Hidden from visitors right now. Switch to Live above to preview or edit.
        </p>
      )}

      {error && (
        <p style={{ marginTop: 12, color: '#b00020', fontSize: 14 }}>{error}</p>
      )}
    </div>
  );
}
