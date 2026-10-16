'use client';
// Plot artwork — the one place to grab the QR for the resting place, as a
// plain QR (for etching) or as a full plaque (for mounting, printing or
// casting). The plaque design is persisted on the plot doc so edits survive a
// reload; QR-only mode is stateless. One URL replaces the earlier
// /plot/[plotId]/qr and /plot/[plotId]/plaque pages.

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { auth, db } from '@/lib/firebase';
import type { PlaqueShape } from '@/lib/types';
import {
  buildPlaqueSvg,
  DEFAULT_PLAQUE_SHAPE,
  MAX_BOTTOM_TEXT_LEN,
  plaqueDimensions,
} from '@/lib/plaque';
import { PageSkeleton } from '@/components/Skeleton';
import { qrWithCenteredImage, sameOriginUrlToDataUrl } from '@/lib/qr';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.liveonwith.me';
const SITE_LOGO_PATH = '/brand/live-on-with-me-logo-512.png';

type Mode = 'qr' | 'plaque';

const SHAPE_OPTIONS: { value: PlaqueShape; label: string }[] = [
  { value: 'oval', label: 'Oval' },
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' },
];

async function fetchCustomMarkDataUrl(plotId: string): Promise<string | null> {
  if (!auth.currentUser) return null;
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`/api/plot/mark?plotId=${encodeURIComponent(plotId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.dataUrl || null;
}

async function svgToPngDataUrl(svg: string, w: number, h: number): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render image.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function PlotArtworkPage({
  params,
}: {
  params: Promise<{ plotId: string }>;
}) {
  const [plot, setPlot] = useState<any>();
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('plaque');

  // Pure QR (margin: 2, standalone, for etching) + its PNG rasterisation.
  const [standaloneQrSvg, setStandaloneQrSvg] = useState('');
  const [standaloneQrPng, setStandaloneQrPng] = useState('');

  // Plaque-embedded QR (margin: 0 — the plaque wrapper provides the quiet
  // area). Decorated the same way (hero or logo in the centre).
  const [plaqueQrSvg, setPlaqueQrSvg] = useState('');

  // Plaque state (persisted to plot.plaqueDesign).
  const [shape, setShape] = useState<PlaqueShape>(DEFAULT_PLAQUE_SHAPE);
  const [bottomText, setBottomText] = useState('');
  const [customMarkPath, setCustomMarkPath] = useState<string | null>(null);
  const [showBorder, setShowBorder] = useState(true);
  const [markDataUrl, setMarkDataUrl] = useState('');
  const [plaqueSvg, setPlaqueSvg] = useState('');
  const [plaquePngUrl, setPlaquePngUrl] = useState('');

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [canDownload, setCanDownload] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const didLoadRef = useRef(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const m = searchParams.get('mode');
    if (m === 'qr' || m === 'plaque') setMode(m);
  }, [searchParams]);

  // Load plot, access-check, and build the two QRs.
  useEffect(() => {
    params.then(({ plotId }) => {
      if (!auth) return;
      return onAuthStateChanged(auth, async (u) => {
        if (!u) return router.push('/auth');
        try {
          const plotSnap = await getDoc(doc(db, 'plots', plotId));
          if (!plotSnap.exists()) {
            setError('That plot could not be found.');
            return;
          }
          const p = { id: plotSnap.id, ...plotSnap.data() } as any;
          const token = await u.getIdToken();
          const accessRes = await fetch(
            `/api/plot/access?plotId=${encodeURIComponent(plotId)}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          const access = accessRes.ok
            ? await accessRes.json()
            : { canManage: false, role: null, anyMemorialPaid: false };
          if (!access.canManage) {
            setError('Only the plot administrator or a referring partner can design artwork for this plot.');
            setPlot(p);
            return;
          }
          setCanDownload(Boolean(access.anyMemorialPaid) || access.role === 'super_admin');
          setPlot(p);

          const design = p.plaqueDesign || {};
          if (design.shape === 'oval' || design.shape === 'round' || design.shape === 'square') {
            setShape(design.shape);
          }
          setBottomText(design.bottomText || '');
          setCustomMarkPath(design.customMarkPath || null);
          setShowBorder(design.showBorder !== false);
          didLoadRef.current = true;

          const target = `${SITE_URL}/p/${p.shortId}`;
          const [standaloneRaw, embeddedRaw, heroRes, logoDataUrl] = await Promise.all([
            QRCode.toString(target, {
              type: 'svg',
              margin: 2,
              color: { dark: '#000000', light: '#ffffff' },
              errorCorrectionLevel: 'H',
            }),
            QRCode.toString(target, {
              type: 'svg',
              margin: 0,
              color: { dark: '#000000', light: '#ffffff' },
              errorCorrectionLevel: 'H',
            }),
            fetch(
              `/api/plot/memorial-hero-photo?plotId=${encodeURIComponent(p.id)}`,
              { headers: { Authorization: `Bearer ${token}` } },
            )
              .then((r) => (r.ok ? r.json() : { dataUrl: null }))
              .catch(() => ({ dataUrl: null })),
            sameOriginUrlToDataUrl(SITE_LOGO_PATH).catch(() => ''),
          ]);

          const heroDataUrl: string | null = heroRes?.dataUrl || null;
          const decorateQr = (raw: string, idPrefix: string) =>
            heroDataUrl
              ? qrWithCenteredImage({
                  qrSvg: raw,
                  imageDataUrl: heroDataUrl,
                  photoShape: 'circle',
                  applyMonoFilter: true,
                  idPrefix: `${idPrefix}Hero`,
                })
              : logoDataUrl
                ? qrWithCenteredImage({
                    qrSvg: raw,
                    imageDataUrl: logoDataUrl,
                    photoShape: 'circle',
                    applyMonoFilter: false,
                    idPrefix: `${idPrefix}Logo`,
                  })
                : raw;

          const standalone = decorateQr(standaloneRaw, 'plotStandalone');
          setStandaloneQrSvg(standalone);
          setPlaqueQrSvg(decorateQr(embeddedRaw, 'plotEmbedded'));

          try {
            const png = await svgToPngDataUrl(standalone, 1024, 1024);
            setStandaloneQrPng(png);
          } catch {
            const png = await QRCode.toDataURL(target, {
              width: 1024,
              margin: 2,
              color: { dark: '#000000', light: '#ffffff' },
              errorCorrectionLevel: 'H',
            });
            setStandaloneQrPng(png);
          }
        } catch (err: any) {
          setError(err.message || 'Something went wrong preparing the artwork.');
        }
      });
    });
  }, [params, router]);

  // Load/refresh the mark data URL whenever customMarkPath changes.
  // Custom marks come through our server (same-origin). The default
  // LiveOnWith.me mark lives in /public and loads same-origin too.
  useEffect(() => {
    if (!plot) return;
    (async () => {
      try {
        if (customMarkPath) {
          const dataUrl = await fetchCustomMarkDataUrl(plot.id);
          if (dataUrl) {
            setMarkDataUrl(dataUrl);
            return;
          }
        }
        const defaultUrl = await sameOriginUrlToDataUrl(SITE_LOGO_PATH);
        setMarkDataUrl(defaultUrl);
      } catch {
        try {
          const fallback = await sameOriginUrlToDataUrl(SITE_LOGO_PATH);
          setMarkDataUrl(fallback);
        } catch {
          /* ignored */
        }
      }
    })();
  }, [customMarkPath, plot]);

  // Rebuild the plaque whenever its inputs change.
  useEffect(() => {
    if (!plaqueQrSvg || !markDataUrl) return;
    const svg = buildPlaqueSvg({
      shape,
      qrSvg: plaqueQrSvg,
      markDataUrl,
      bottomText,
      showBorder,
    });
    setPlaqueSvg(svg);
    const { w, h } = plaqueDimensions(shape);
    svgToPngDataUrl(svg, w * 4, h * 4)
      .then(setPlaquePngUrl)
      .catch(() => setPlaquePngUrl(''));
  }, [plaqueQrSvg, markDataUrl, shape, bottomText, showBorder]);

  async function saveDesign(next: {
    shape?: PlaqueShape;
    bottomText?: string;
    customMarkPath?: string | null;
    showBorder?: boolean;
  }) {
    if (!plot || !auth.currentUser) return;
    setSavingState('saving');
    setSaveError('');
    try {
      const token = await auth.currentUser.getIdToken();
      const payload: Record<string, unknown> = {
        plotId: plot.id,
        shape: next.shape ?? shape,
        bottomText: next.bottomText ?? bottomText,
        showBorder: next.showBorder ?? showBorder,
      };
      if (next.customMarkPath !== undefined) payload.customMarkPath = next.customMarkPath;
      const res = await fetch('/api/plot/plaque-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      setSavingState('saved');
    } catch (err: any) {
      setSavingState('error');
      setSaveError(err.message || 'Could not save.');
    }
  }

  // Debounced autosave of bottomText.
  useEffect(() => {
    if (!didLoadRef.current || !plot) return;
    const t = setTimeout(() => {
      saveDesign({ bottomText });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomText]);

  function changeShape(next: PlaqueShape) {
    setShape(next);
    saveDesign({ shape: next });
  }

  function toggleBorder(next: boolean) {
    setShowBorder(next);
    saveDesign({ showBorder: next });
  }

  async function uploadMark(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !plot || !auth.currentUser) return;
    setUploadError('');
    setUploading(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const form = new FormData();
      form.append('file', file);
      form.append('plotId', plot.id);
      const res = await fetch('/api/plot/upload-mark', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      if (data.dataUrl) setMarkDataUrl(data.dataUrl);
      setCustomMarkPath(data.path);
      await saveDesign({ customMarkPath: data.path });
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function resetMark() {
    setCustomMarkPath(null);
    await saveDesign({ customMarkPath: null });
  }

  function downloadQrSvg() {
    if (!standaloneQrSvg || !plot) return;
    const blob = new Blob([standaloneQrSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plot-${plot.shortId}-qr.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadQrPng() {
    if (!standaloneQrPng || !plot) return;
    const a = document.createElement('a');
    a.href = standaloneQrPng;
    a.download = `plot-${plot.shortId}-qr.png`;
    a.click();
  }

  function downloadPlaqueSvg() {
    if (!plaqueSvg || !plot) return;
    const blob = new Blob([plaqueSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plot-${plot.shortId}-plaque-${shape}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPlaquePng() {
    if (!plaquePngUrl || !plot) return;
    const a = document.createElement('a');
    a.href = plaquePngUrl;
    a.download = `plot-${plot.shortId}-plaque-${shape}.png`;
    a.click();
  }

  if (error) {
    return (
      <main className="shell">
        <div className="formCard center">
          <div className="eyebrow">Artwork</div>
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

  if (!plot || !standaloneQrSvg || !plaqueQrSvg) {
    return <PageSkeleton variant="detail" label="Preparing your artwork" />;
  }

  const shortUrl = `${SITE_URL}/p/${plot.shortId}`;
  const previewMaxWidth = shape === 'oval' ? 320 : 380;

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">For the resting place</div>
        <h2>{plot.name || plot.cemetery?.name || 'Plot artwork'}</h2>
        <p className="muted">
          Scans go to a single page that lists every memorial at this plot — present and future —
          so the artwork never needs remaking as more names are added.
        </p>

        <div
          role="tablist"
          aria-label="Artwork style"
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 24,
            background: 'var(--sage2)',
            padding: 4,
            borderRadius: 999,
          }}
        >
          <button
            role="tab"
            aria-selected={mode === 'qr'}
            type="button"
            onClick={() => setMode('qr')}
            className={mode === 'qr' ? 'button' : 'button secondary'}
            style={{ flex: 1, background: mode === 'qr' ? undefined : 'transparent', border: 0 }}
          >
            Plain QR
          </button>
          <button
            role="tab"
            aria-selected={mode === 'plaque'}
            type="button"
            onClick={() => setMode('plaque')}
            className={mode === 'plaque' ? 'button' : 'button secondary'}
            style={{ flex: 1, background: mode === 'plaque' ? undefined : 'transparent', border: 0 }}
          >
            Full plaque
          </button>
        </div>

        {mode === 'qr' && (
          <>
            <p className="muted" style={{ marginTop: 20, fontSize: 14 }}>
              The bare QR as pure vector — for a stonemason to etch directly into the headstone,
              or to print on a laminated card as an interim marker.
            </p>
            <div
              style={{
                margin: '24px auto',
                maxWidth: 340,
                borderRadius: 16,
                border: '1px solid var(--line)',
                background: 'white',
                padding: 16,
              }}
              dangerouslySetInnerHTML={{
                __html: standaloneQrSvg.replace(
                  /<svg([^>]*)>/,
                  '<svg$1 style="display:block;width:100%;height:auto;">',
                ),
              }}
            />
            <p className="muted" style={{ fontSize: 13, wordBreak: 'break-all', textAlign: 'center' }}>
              {shortUrl}
            </p>
            {!canDownload && (
              <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 20 }}>
                Downloads unlock once at least one memorial on this plot is paid for and live.{' '}
                <Link
                  href={`/plot/${plot.id}/manage`}
                  style={{ color: 'var(--brand)', textDecoration: 'underline' }}
                >
                  Open plot admin
                </Link>
                .
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
              <button
                className="button"
                onClick={downloadQrSvg}
                disabled={!canDownload}
                title={!canDownload ? 'Downloads unlock once a memorial on this plot is paid for.' : undefined}
              >
                Download SVG (for your engraver)
              </button>
              <button
                className="button secondary"
                onClick={downloadQrPng}
                disabled={!canDownload || !standaloneQrPng}
                title={!canDownload ? 'Downloads unlock once a memorial on this plot is paid for.' : undefined}
              >
                Download PNG (for print)
              </button>
            </div>

            <div style={{ textAlign: 'left', marginTop: 36, background: '#fffdf9', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 22px' }}>
              <h3 style={{ marginTop: 0 }}>For your engraver</h3>
              <ul className="muted" style={{ marginTop: 0, paddingLeft: 22 }}>
                <li>Etch at 40&nbsp;mm × 40&nbsp;mm or larger for reliable scanning.</li>
                <li>Keep the quiet border (white space) around the pattern — the scanner relies on it.</li>
                <li>Highest error-correction is set, so minor weathering or scratching won&rsquo;t stop it working.</li>
                <li>Test with a phone before finishing — it should scan from about half a metre away.</li>
              </ul>
            </div>
          </>
        )}

        {mode === 'plaque' && (
          <>
            <p className="muted" style={{ marginTop: 20, fontSize: 14 }}>
              The full finished plaque — shape, border, your choice of mark on top, and an
              optional line of text underneath. For producing a physical plaque to mount on a
              headstone, bench, columbarium, tree marker or anywhere a QR can live.
            </p>

            <div style={{ margin: '28px auto 10px', maxWidth: previewMaxWidth, textAlign: 'center' }}>
              {plaquePngUrl ? (
                <img
                  src={plaquePngUrl}
                  alt="Plaque preview"
                  style={{
                    width: '100%',
                    borderRadius: 16,
                    border: '1px solid var(--line)',
                    background: 'white',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    aspectRatio: shape === 'oval' ? '2 / 3' : '1 / 1',
                    borderRadius: 16,
                    border: '1px solid var(--line)',
                    background: '#f7f4ee',
                  }}
                />
              )}
            </div>

            <p className="muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 0, minHeight: 18 }}>
              {savingState === 'saving' && 'Saving design…'}
              {savingState === 'saved' && 'Design saved'}
              {savingState === 'error' && (
                <span style={{ color: '#a94442' }}>Couldn&rsquo;t save — {saveError}</span>
              )}
              {savingState === 'idle' && ' '}
            </p>

            <div style={{ marginTop: 20 }}>
              <label>Shape</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {SHAPE_OPTIONS.map((opt) => {
                  const selected = shape === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => changeShape(opt.value)}
                      className={selected ? 'button' : 'button secondary'}
                      style={{ flex: '1 1 100px' }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <label>Border</label>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                A thin outline around the plaque. Hide it if the stone itself already defines the edge.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => toggleBorder(true)}
                  className={showBorder ? 'button' : 'button secondary'}
                  style={{ flex: '1 1 100px' }}
                >
                  With border
                </button>
                <button
                  type="button"
                  onClick={() => toggleBorder(false)}
                  className={!showBorder ? 'button' : 'button secondary'}
                  style={{ flex: '1 1 100px' }}
                >
                  No border
                </button>
              </div>
            </div>

            <div style={{ marginTop: 24 }}>
              <label>Mark (top of the plaque)</label>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                By default we use the LiveOnWith.me mark. Replace it with a family crest, cross,
                rose or anything that feels right. High-contrast silhouettes reproduce best.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={uploadMark}
                style={{ display: 'none' }}
              />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? 'Uploading…' : customMarkPath ? 'Replace image' : 'Upload your own image'}
                </button>
                {customMarkPath && (
                  <button type="button" className="button secondary" onClick={resetMark} disabled={uploading}>
                    Reset to LiveOnWith.me mark
                  </button>
                )}
              </div>
              {uploadError && (
                <p style={{ color: '#a94442', marginTop: 10, fontSize: 14 }}>{uploadError}</p>
              )}
            </div>

            <div style={{ marginTop: 24 }}>
              <label htmlFor="bottomText">Bottom text (optional)</label>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                A short line beneath the QR — a family name or similar. Keep it durable: dates or
                a single person&rsquo;s name may feel out of place once others rest here.
              </p>
              <input
                id="bottomText"
                type="text"
                value={bottomText}
                onChange={(e) => setBottomText(e.target.value)}
                placeholder="e.g. The Rooney Family"
                maxLength={MAX_BOTTOM_TEXT_LEN}
              />
              <p className="muted" style={{ fontSize: 12, marginTop: 6, textAlign: 'right' }}>
                {bottomText.length}/{MAX_BOTTOM_TEXT_LEN}
              </p>
            </div>

            {!canDownload && (
              <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 24 }}>
                Downloads unlock once at least one memorial on this plot is paid for and live.{' '}
                <Link
                  href={`/plot/${plot.id}/manage`}
                  style={{ color: 'var(--brand)', textDecoration: 'underline' }}
                >
                  Open plot admin
                </Link>
                .
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 30, flexWrap: 'wrap' }}>
              <button
                className="button"
                onClick={downloadPlaqueSvg}
                disabled={!canDownload || !plaqueSvg}
                title={!canDownload ? 'Downloads unlock once a memorial on this plot is paid for.' : undefined}
              >
                Download SVG (for your supplier)
              </button>
              <button
                className="button secondary"
                onClick={downloadPlaquePng}
                disabled={!canDownload || !plaquePngUrl}
                title={!canDownload ? 'Downloads unlock once a memorial on this plot is paid for.' : undefined}
              >
                Download PNG (for print)
              </button>
            </div>

            <div style={{ textAlign: 'left', marginTop: 36, background: '#fffdf9', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 22px' }}>
              <h3 style={{ marginTop: 0 }}>For whoever makes the plaque</h3>
              <ul className="muted" style={{ marginTop: 0, paddingLeft: 22 }}>
                <li>
                  Oval plaques typically come at 120&nbsp;×&nbsp;180&nbsp;mm or 160&nbsp;×&nbsp;240&nbsp;mm; round
                  and square at 120&nbsp;mm or 180&nbsp;mm across.
                </li>
                <li>
                  The QR, border and text are pure vector. The brand mark (or your uploaded image) is
                  embedded as a high-resolution bitmap — fine for laser etching, UV print or CNC. For
                  sandblast or cast metal, supply a vector mark separately if available.
                </li>
                <li>Keep the inner white space around the QR; the scanner relies on that quiet border.</li>
                <li>Test with a phone before finishing. It should scan from about half a metre away.</li>
              </ul>
            </div>
          </>
        )}

        <div style={{ marginTop: 30, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href={`/plot/${plot.id}/manage`} className="button soft">
            Back to plot admin
          </Link>
          <Link href={`/plot/${plot.id}`} className="button soft">
            View plot page
          </Link>
        </div>
      </div>
    </main>
  );
}
