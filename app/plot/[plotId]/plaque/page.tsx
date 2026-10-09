'use client';
// Plot plaque builder — pick a shape (oval / round / square), optionally
// upload a custom mark in place of the LiveOnWith.me logo, and add a short
// line of text at the bottom. The design is per-plot (not per-memorial)
// because the plot outlives any single person. Design is persisted on the
// plot doc so edits survive a page reload.

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { auth, db } from '@/lib/firebase';
import type { PlaqueShape } from '@/lib/types';
import { buildPlaqueSvg, DEFAULT_PLAQUE_SHAPE, MAX_BOTTOM_TEXT_LEN, plaqueDimensions } from '@/lib/plaque';
import { PageSkeleton } from '@/components/Skeleton';
import { qrWithCenteredImage } from '@/lib/qr';

const SITE_LOGO_PATH = '/brand/live-on-with-me-logo-512.png';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.liveonwith.me';

const SHAPE_OPTIONS: { value: PlaqueShape; label: string }[] = [
  { value: 'oval', label: 'Oval' },
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' },
];

// Same-origin fetch — used for the default LiveOnWith.me mark bundled under
// /public. Custom marks never go through this because R2 is cross-origin.
async function sameOriginUrlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

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

async function renderSvgToPngDataUrl(svg: string, w: number, h: number): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render plaque image.'));
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

export default function PlotPlaque({
  params,
}: {
  params: Promise<{ plotId: string }>;
}) {
  const [plot, setPlot] = useState<any>();
  const [error, setError] = useState('');

  const [shape, setShape] = useState<PlaqueShape>(DEFAULT_PLAQUE_SHAPE);
  const [bottomText, setBottomText] = useState('');
  const [customMarkPath, setCustomMarkPath] = useState<string | null>(null);
  const [showBorder, setShowBorder] = useState(true);

  const [qrSvg, setQrSvg] = useState('');
  const [markDataUrl, setMarkDataUrl] = useState('');
  const [plaqueSvg, setPlaqueSvg] = useState('');
  const [plaquePngUrl, setPlaquePngUrl] = useState('');

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const didLoadRef = useRef(false);
  const router = useRouter();

  // 1) Load plot + initial design.
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
          // Access covers plot admin, successor, super_admin AND referring
          // partner (if they have an active referral for a memorial here).
          const token = await u.getIdToken();
          const accessRes = await fetch(
            `/api/plot/access?plotId=${encodeURIComponent(plotId)}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          const access = accessRes.ok ? await accessRes.json() : { canManage: false };
          if (!access.canManage) {
            setError('Only the plot administrator or a referring partner can design this plaque.');
            setPlot(p);
            return;
          }
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
          const [rawQr, heroRes, logoDataUrl] = await Promise.all([
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
          // Drop the hero (mono + contrast) into the centre of the QR so the
          // engraved code carries a face at a glance. If no memorial on the
          // plot has a hero yet, fall back to the site mark untreated — a
          // calm neutral until the family uploads a photo.
          const decoratedQr = heroDataUrl
            ? qrWithCenteredImage({
                qrSvg: rawQr,
                imageDataUrl: heroDataUrl,
                photoShape: 'circle',
                applyMonoFilter: true,
                idPrefix: 'plotPlaqueHero',
              })
            : logoDataUrl
              ? qrWithCenteredImage({
                  qrSvg: rawQr,
                  imageDataUrl: logoDataUrl,
                  photoShape: 'circle',
                  applyMonoFilter: false,
                  idPrefix: 'plotPlaqueLogo',
                })
              : rawQr;
          setQrSvg(decoratedQr);
        } catch (err: any) {
          setError(err.message || 'Something went wrong preparing the plaque.');
        }
      });
    });
  }, [params, router]);

  // 2) Load/refresh the mark data URL whenever customMarkPath changes.
  //    Custom marks come through our server (same-origin), never a direct R2
  //    fetch — R2's public URL is cross-origin and would be blocked by CORS,
  //    which was the cause of custom-mark previews silently falling back to
  //    the default logo. The default LiveOnWith.me mark lives in /public and
  //    is loaded same-origin.
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
        const defaultUrl = await sameOriginUrlToDataUrl('/brand/live-on-with-me-logo-512.png');
        setMarkDataUrl(defaultUrl);
      } catch {
        try {
          const fallback = await sameOriginUrlToDataUrl('/brand/live-on-with-me-logo-512.png');
          setMarkDataUrl(fallback);
        } catch {
          /* ignored */
        }
      }
    })();
  }, [customMarkPath, plot]);

  // 3) Rebuild the SVG + PNG whenever any of its inputs change.
  useEffect(() => {
    if (!qrSvg || !markDataUrl) return;
    const svg = buildPlaqueSvg({ shape, qrSvg, markDataUrl, bottomText, showBorder });
    setPlaqueSvg(svg);
    const { w, h } = plaqueDimensions(shape);
    // Render at ~4× for a crisp preview and print-ready download.
    renderSvgToPngDataUrl(svg, w * 4, h * 4)
      .then(setPlaquePngUrl)
      .catch(() => setPlaquePngUrl(''));
  }, [qrSvg, markDataUrl, shape, bottomText, showBorder]);

  // 4) Persist design changes to the plot doc.
  //    Shape + border + mark save immediately; bottomText autosaves on debounce.
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
      // Use the data URL the server returned so the preview updates
      // immediately, without a cross-origin re-fetch to R2.
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

  function downloadSvg() {
    if (!plaqueSvg || !plot) return;
    const blob = new Blob([plaqueSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plot-${plot.shortId}-plaque-${shape}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPng() {
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
          <div className="eyebrow">Plaque</div>
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

  if (!plot || !plaqueSvg) {
    return <PageSkeleton variant="detail" label="Preparing your plaque" />;
  }

  const previewMaxWidth = shape === 'oval' ? 320 : 380;

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">For the grave</div>
        <h2>{plot.name || plot.cemetery?.name || 'Plot plaque'}</h2>
        <p className="muted">
          The plaque that goes on the stone. The QR links to every memorial at this plot — present
          and future — so there&rsquo;s nothing on the plaque that would need re-engraving later.
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          For a personal plaque for a single person — mantelpiece, prayer card, wake — use the{' '}
          <span style={{ fontStyle: 'italic' }}>For a keepsake</span> option from each memorial&rsquo;s
          manage page.
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
            A thin outline around the plaque. Hide it if the stone itself already defines the
            edge.
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
            By default we use the LiveOnWith.me mark. You can replace it with your own image — a
            family crest, a cross, a rose, anything that feels right. High-contrast silhouettes
            engrave best.
          </p>
          <input
            ref={fileInputRef}
            id="markUpload"
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
            A short line engraved beneath the QR — a family name or similar. Keep it durable:
            dates or a single person&rsquo;s name may feel out of place once others rest here.
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

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 30, flexWrap: 'wrap' }}>
          <button className="button" onClick={downloadSvg}>
            Download SVG (for your engraver)
          </button>
          <button className="button secondary" onClick={downloadPng}>
            Download PNG (for print)
          </button>
        </div>

        <div style={{ textAlign: 'left', marginTop: 40, background: '#fffdf9', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 22px' }}>
          <h3 style={{ marginTop: 0 }}>For your engraver</h3>
          <p className="muted" style={{ marginBottom: 8 }}>
            A few gentle suggestions for whoever does the engraving (e.g. a stonemason or laser
            engraver):
          </p>
          <ul className="muted" style={{ marginTop: 0, paddingLeft: 22 }}>
            <li>
              Oval plaques typically come at 120&nbsp;×&nbsp;180&nbsp;mm or 160&nbsp;×&nbsp;240&nbsp;mm; round
              and square at 120&nbsp;mm or 180&nbsp;mm across.
            </li>
            <li>
              The QR, border and text are pure vector. The brand mark (or your uploaded image) is
              embedded as a high-resolution bitmap — fine for laser etching. For sandblast, supply
              a vector mark separately if available.
            </li>
            <li>Keep the inner white space around the QR; the scanner relies on that quiet border.</li>
            <li>Test with a phone before finishing. It should scan from about half a metre away.</li>
          </ul>
        </div>

        <div style={{ marginTop: 30, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href={`/plot/${plot.id}/qr`} className="button soft">
            QR code only
          </Link>
          <Link href={`/plot/${plot.id}`} className="button soft">
            View plot page
          </Link>
        </div>
      </div>
    </main>
  );
}
