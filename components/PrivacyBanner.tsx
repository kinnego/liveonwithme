'use client';
// Slim, dismissible privacy strip. There are no tracking cookies to consent
// to on this site — only Firebase auth sessions — so this is informational
// rather than a GDPR consent gate. Dismissal is remembered via localStorage
// so returning visitors don't see it again.

import Link from 'next/link';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'lowm_privacy_ack';

export default function PrivacyBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      /* localStorage unavailable (private mode, etc.) — just leave hidden */
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Privacy notice"
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 12,
        maxWidth: 720,
        margin: '0 auto',
        background: '#1f1b16',
        color: '#f4efe4',
        borderRadius: 14,
        padding: '12px 16px',
        display: 'flex',
        gap: 14,
        alignItems: 'center',
        flexWrap: 'wrap',
        boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
        fontSize: 13,
        zIndex: 9000,
      }}
    >
      <span style={{ flex: '1 1 240px', lineHeight: 1.45 }}>
        We only use essential cookies — to keep you signed in. No tracking, no analytics.{' '}
        <Link
          href="/privacy"
          style={{ color: '#f4efe4', textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
          Read our privacy notice
        </Link>
        .
      </span>
      <button
        type="button"
        onClick={dismiss}
        style={{
          background: '#f4efe4',
          color: '#1f1b16',
          border: 0,
          borderRadius: 10,
          padding: '7px 14px',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Got it
      </button>
    </div>
  );
}
