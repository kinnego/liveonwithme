'use client';
// Plot QR — generates both an SVG (vector, for a stonemason to etch directly
// onto the headstone at any size) and a 1024px PNG (for printing on a card or
// laminated marker in the meantime). URL is /p/[shortId] so the payload is as
// short as possible — better for high-contrast etching.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import { isPlotAdmin } from '@/lib/plot';
import type { UserProfile } from '@/lib/types';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function PlotQr({
  params,
}: {
  params: Promise<{ plotId: string }>;
}) {
  const [plot, setPlot] = useState<any>();
  const [error, setError] = useState('');
  const [pngUrl, setPngUrl] = useState('');
  const [svgText, setSvgText] = useState('');
  const router = useRouter();

  useEffect(() => {
    params.then(({ plotId }) => {
      if (!auth) return;
      return onAuthStateChanged(auth, async (u) => {
        if (!u) return router.push('/auth');
        const [plotSnap, userSnap] = await Promise.all([
          getDoc(doc(db, 'plots', plotId)),
          getDoc(doc(db, 'users', u.uid)),
        ]);
        if (!plotSnap.exists()) {
          setError('That plot could not be found.');
          return;
        }
        const p = { id: plotSnap.id, ...plotSnap.data() } as any;
        const profile = userSnap.exists() ? (userSnap.data() as UserProfile) : null;
        const canView = isPlotAdmin(p, u.uid) || isSuperAdmin(profile);
        if (!canView) {
          setError('Only the plot administrator can generate QR codes for this plot.');
          setPlot(p);
          return;
        }
        setPlot(p);
        const target = `${window.location.origin}/p/${p.shortId}`;
        const [png, svg] = await Promise.all([
          QRCode.toDataURL(target, {
            width: 1024,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
            errorCorrectionLevel: 'H',
          }),
          QRCode.toString(target, {
            type: 'svg',
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
            errorCorrectionLevel: 'H',
          }),
        ]);
        setPngUrl(png);
        setSvgText(svg);
      });
    });
  }, [params, router]);

  function downloadPng() {
    if (!pngUrl || !plot) return;
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = `plot-${plot.shortId}-qr.png`;
    a.click();
  }

  function downloadSvg() {
    if (!svgText || !plot) return;
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plot-${plot.shortId}-qr.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) {
    return (
      <main className="shell">
        <div className="formCard center">
          <div className="eyebrow">Plot QR</div>
          <h2>Not available</h2>
          <p className="muted">{error}</p>
          {plot && (
            <Link href={`/plot/${plot.id}`} className="button" style={{ marginTop: 20 }}>
              Back to plot
            </Link>
          )}
        </div>
      </main>
    );
  }

  if (!plot || !pngUrl) {
    return <PageSkeleton variant="detail" label="Preparing your QR code" />;
  }

  const shortUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/p/${plot.shortId}`;

  return (
    <main className="shell">
      <div className="formCard center">
        <div className="eyebrow">Plot QR code</div>
        <h2>{plot.name || plot.cemetery.name}</h2>
        <p className="muted">
          This QR code links to <strong>every memorial</strong> associated with this plot.
          Anyone who scans it will land on a page listing everyone remembered here.
        </p>
        <div style={{ margin: '30px auto', maxWidth: 340 }}>
          <img
            src={pngUrl}
            alt={`QR code for plot ${plot.shortId}`}
            style={{
              width: '100%',
              borderRadius: 16,
              border: '1px solid var(--line)',
              background: 'white',
            }}
          />
        </div>
        <p className="muted" style={{ fontSize: 13, wordBreak: 'break-all' }}>
          {shortUrl}
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <button className="button" onClick={downloadSvg}>
            Download SVG (for stonemason)
          </button>
          <button className="button secondary" onClick={downloadPng}>
            Download PNG (for print)
          </button>
        </div>

        <div style={{ textAlign: 'left', marginTop: 40, background: '#fffdf9', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 22px' }}>
          <h3 style={{ marginTop: 0 }}>For stonemasons</h3>
          <p className="muted" style={{ marginBottom: 8 }}>
            The SVG is pure vector — it can be scaled to any size without losing sharpness,
            which makes it suitable for direct etching. A few gentle suggestions:
          </p>
          <ul className="muted" style={{ marginTop: 0, paddingLeft: 22 }}>
            <li>Etch at 40&nbsp;mm × 40&nbsp;mm or larger for reliable scanning.</li>
            <li>Keep the quiet border (white space) around the pattern — it&rsquo;s the frame the scanner relies on.</li>
            <li>The QR is generated with the highest error-correction setting, so minor weathering or scratching won&rsquo;t stop it working.</li>
            <li>Test with a phone before finishing — it should scan from about half a metre away.</li>
          </ul>
        </div>

        <div style={{ marginTop: 30 }}>
          <Link href={`/plot/${plot.id}`} className="button soft">
            View plot page
          </Link>
        </div>
      </div>
    </main>
  );
}
