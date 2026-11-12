// A one-page A4 leaflet for parish newsletters and noticeboards. No QR — the
// per-cemetery visitor poster at /cemetery/[placeId]/artwork handles that;
// this leaflet only needs to point the parish at liveonwith.me/parishes.
// Print hides the site header and footer.

import type { Metadata } from 'next';
import PrintButton from './PrintButton';
import { SUPER_ADMIN_EMAIL } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Leaflet for parishes · LiveOnWith.me',
};

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.liveonwith.me').replace(/\/$/, '');

export default async function ParishFlyerPage() {
  const url = `${SITE_URL}/parishes`;
  const shortUrl = url.replace(/^https?:\/\/(www\.)?/, '');

  return (
    <main style={{ padding: '20px 16px 60px' }}>
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          .siteHeader, footer, .noPrint, [aria-label="Privacy notice"] { display: none !important; }
          body, main { background: white !important; }
          main { padding: 0 !important; min-height: 0 !important; }
          .flyer { box-shadow: none !important; border: 0 !important; padding: 0 !important; }
        }
        .flyer ol li { margin-bottom: 8px; }
      `}</style>
      <div className="noPrint" style={{ maxWidth: 720, margin: '0 auto 18px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <PrintButton />
        <span className="muted" style={{ fontSize: 14 }}>Put it in the parish newsletter or on the noticeboard.</span>
      </div>

      <article
        className="flyer card"
        style={{ maxWidth: 720, margin: '0 auto', padding: '40px 44px', fontSize: 17, lineHeight: 1.55 }}
      >
        <div className="eyebrow">For parishes and graveyards</div>
        <h1 style={{ fontSize: 44, letterSpacing: '-0.02em', margin: '10px 0 14px' }}>
          Help families find their loved one&rsquo;s grave
        </h1>
        <p style={{ fontSize: 20, margin: '0 0 22px' }}>
          Put your parish burial register online with <strong>LiveOnWith.me</strong>. It&rsquo;s free.
        </p>

        <p style={{ margin: '0 0 10px' }}>
          Then anyone can type a name and find the grave: the graveyard, the row, the plot number,
          and directions right to it. No more phone calls asking &ldquo;where is Granny
          buried?&rdquo;
        </p>

        <h2 style={{ fontSize: 26, margin: '24px 0 10px' }}>How it works</h2>
        <ol style={{ paddingLeft: 22, margin: 0 }}>
          <li><strong>Find your graveyard.</strong> Your phone can show the ones closest to you. Then sign in with your email.</li>
          <li><strong>Tell us about your burial book.</strong> Handwritten, typed or on a computer are all fine.</li>
          <li><strong>Put the names online, whichever way suits you:</strong> photograph the pages and let the free ChatGPT app type them up for you, <strong>OR</strong> type them in, <strong>OR</strong> email us and we&rsquo;ll help. You only need one.</li>
          <li><strong>Walk the graveyard</strong> with your phone and tap &ldquo;Pin here&rdquo; at each grave, if you like.</li>
        </ol>

        <div
          style={{
            marginTop: 30,
            paddingTop: 24,
            borderTop: '1px solid var(--line)',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 20 }}>
            Get started at <strong>{shortUrl}</strong>
          </div>
          <div className="muted" style={{ marginTop: 10 }}>
            Questions? Email <strong>{SUPER_ADMIN_EMAIL}</strong> and a real person will help.
          </div>
        </div>
      </article>
    </main>
  );
}
