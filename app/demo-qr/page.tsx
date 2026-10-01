'use client';
// Demo QR designer — a plaque-style artwork pointing at the Mary demo
// memorial, for partners (funeral directors, stonemasons, etc.) to print
// and leave in their shop. Shares all the real plaque options (shape,
// border, custom mark) so partners can match it to their branding, plus
// portrait/landscape for the oval variant. The bottom text is hard-wired
// to a "demo only" disclaimer so the finished artwork can't be mistaken
// for a real memorial the shop is managing.

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { auth, db } from '@/lib/firebase';
import { isApprovedPartner, isSuperAdmin } from '@/lib/roles';
import type { PlaqueShape, PlaqueOrientation, UserProfile } from '@/lib/types';
import {
  buildPlaqueSvg,
  DEFAULT_PLAQUE_SHAPE,
  DEFAULT_PLAQUE_ORIENTATION,
  plaqueDimensions,
} from '@/lib/plaque';
import { DEMO_PORTRAIT_DATA_URL } from '@/lib/demo-portrait';
import { qrWithCenteredImage, sameOriginUrlToDataUrl } from '@/lib/qr';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.liveonwith.me';
const DEMO_PATH = '/m/mary-demo';
const DEMO_LABEL = 'Demo';
const MAX_MARK_BYTES = 1_500_000;

const SHAPE_OPTIONS: { value: PlaqueShape; label: string }[] = [
  { value: 'oval', label: 'Oval' },
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' },
];

const ORIENTATION_OPTIONS: { value: PlaqueOrientation; label: string }[] = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

type Access = 'checking' | 'denied' | 'ok';

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

type QrStyle = 'standard' | 'photo' | 'logo';

async function renderSvgToPngDataUrl(svg: string, w: number, h: number): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render demo image.'));
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

export default function DemoQrPage() {
  const [access, setAccess] = useState<Access>('checking');

  const [shape, setShape] = useState<PlaqueShape>(DEFAULT_PLAQUE_SHAPE);
  const [orientation, setOrientation] = useState<PlaqueOrientation>(DEFAULT_PLAQUE_ORIENTATION);
  const [showBorder, setShowBorder] = useState(true);
  const [customMarkDataUrl, setCustomMarkDataUrl] = useState<string | null>(null);
  const [markError, setMarkError] = useState('');
  const [qrStyle, setQrStyle] = useState<QrStyle>('photo');

  const [qrSvg, setQrSvg] = useState('');
  const [defaultMarkDataUrl, setDefaultMarkDataUrl] = useState('');
  const [plaqueSvg, setPlaqueSvg] = useState('');
  const [plaquePngUrl, setPlaquePngUrl] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return router.push('/auth');
      const snap = await getDoc(doc(db, 'users', u.uid));
      const prof = snap.exists() ? (snap.data() as UserProfile) : null;
      const ok = isSuperAdmin(prof) || isApprovedPartner(prof);
      setAccess(ok ? 'ok' : 'denied');
    });
  }, [router]);

  useEffect(() => {
    if (access !== 'ok') return;
    const target = `${SITE_URL}${DEMO_PATH}`;
    let cancelled = false;
    (async () => {
      try {
        const [qr, mark] = await Promise.all([
          QRCode.toString(target, {
            type: 'svg',
            margin: 0,
            color: { dark: '#000000', light: '#ffffff' },
            errorCorrectionLevel: 'H',
          }),
          sameOriginUrlToDataUrl('/brand/live-on-with-me-logo-512.png'),
        ]);
        if (cancelled) return;
        setQrSvg(qr);
        setDefaultMarkDataUrl(mark);
      } catch {
        /* ignored — preview will stay blank until retry */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [access]);

  useEffect(() => {
    if (!qrSvg || !defaultMarkDataUrl) return;
    const markDataUrl = customMarkDataUrl || defaultMarkDataUrl;
    let qrForPlaque = qrSvg;
    if (qrStyle === 'photo') {
      qrForPlaque = qrWithCenteredImage({
        qrSvg,
        imageDataUrl: DEMO_PORTRAIT_DATA_URL,
        photoShape: 'circle',
        applyMonoFilter: true,
        idPrefix: 'demoPhoto',
      });
    } else if (qrStyle === 'logo') {
      qrForPlaque = qrWithCenteredImage({
        qrSvg,
        imageDataUrl: defaultMarkDataUrl,
        photoShape: 'circle',
        applyMonoFilter: false,
        idPrefix: 'demoLogo',
      });
    }
    const svg = buildPlaqueSvg({
      shape,
      orientation,
      qrSvg: qrForPlaque,
      markDataUrl,
      bottomText: DEMO_LABEL,
      showBorder,
    });
    setPlaqueSvg(svg);
    const { w, h } = plaqueDimensions(shape, orientation);
    renderSvgToPngDataUrl(svg, w * 4, h * 4)
      .then(setPlaquePngUrl)
      .catch(() => setPlaquePngUrl(''));
  }, [
    qrSvg,
    defaultMarkDataUrl,
    customMarkDataUrl,
    shape,
    orientation,
    showBorder,
    qrStyle,
  ]);

  async function uploadMark(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMarkError('');
    if (file.size > MAX_MARK_BYTES) {
      setMarkError('That image is a little big — please choose one under 1.5 MB.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setCustomMarkDataUrl(dataUrl);
    } catch {
      setMarkError("Couldn't read that image. Try a PNG, JPG or SVG.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function resetMark() {
    setCustomMarkDataUrl(null);
  }

  function filenameBase(ext: string) {
    const shapeTag = shape === 'oval' ? `${shape}-${orientation}` : shape;
    return `liveonwithme-demo-${shapeTag}-${qrStyle}.${ext}`;
  }

  function downloadSvg() {
    if (!plaqueSvg) return;
    const blob = new Blob([plaqueSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filenameBase('svg');
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPng() {
    if (!plaquePngUrl) return;
    const a = document.createElement('a');
    a.href = plaquePngUrl;
    a.download = filenameBase('png');
    a.click();
  }

  if (access === 'checking') {
    return <PageSkeleton variant="default" label="Checking access" />;
  }

  if (access === 'denied') {
    return (
      <main className="shell">
        <div className="formCard center">
          <div className="eyebrow">Demo QR</div>
          <h2>Not available</h2>
          <p className="muted">
            This page is for approved partners and site administrators. If you&rsquo;ve applied
            to become a partner, we&rsquo;ll email you once your application is approved.
          </p>
          <Link href="/partner/apply" className="button" style={{ marginTop: 20 }}>
            Apply to become a partner
          </Link>
        </div>
      </main>
    );
  }

  if (!qrSvg || !defaultMarkDataUrl) {
    return <PageSkeleton variant="detail" label="Preparing your demo" />;
  }

  const isLandscape = shape === 'oval' && orientation === 'landscape';
  const previewMaxWidth = isLandscape ? 460 : shape === 'oval' ? 320 : 380;
  const target = `${SITE_URL}${DEMO_PATH}`;

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">Demo QR designer</div>
        <h2>A sample memorial for you to display how it works</h2>
        <p className="muted">
          Design a demo card that links to the Mary O&rsquo;Donnell sample memorial. The
          &ldquo;{DEMO_LABEL}&rdquo; line is engraved into the artwork so no one mistakes it for
          a real memorial you&rsquo;re managing.
        </p>

        <div style={{ margin: '28px auto 10px', maxWidth: previewMaxWidth, textAlign: 'center' }}>
          {plaquePngUrl ? (
            <img
              src={plaquePngUrl}
              alt="Demo plaque preview"
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
                aspectRatio: isLandscape ? '3 / 2' : shape === 'oval' ? '2 / 3' : '1 / 1',
                borderRadius: 16,
                border: '1px solid var(--line)',
                background: '#f7f4ee',
              }}
            />
          )}
        </div>

        <div style={{ marginTop: 20 }}>
          <label>Shape</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {SHAPE_OPTIONS.map((opt) => {
              const selected = shape === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setShape(opt.value)}
                  className={selected ? 'button' : 'button secondary'}
                  style={{ flex: '1 1 100px' }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {shape === 'oval' && (
          <div style={{ marginTop: 20 }}>
            <label>Orientation</label>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Landscape sits nicely on a counter card holder; portrait fits a window strip.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {ORIENTATION_OPTIONS.map((opt) => {
                const selected = orientation === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setOrientation(opt.value)}
                    className={selected ? 'button' : 'button secondary'}
                    style={{ flex: '1 1 100px' }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <label>Border</label>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            A thin outline around the plaque. Hide it if you&rsquo;re layering this onto your
            own card design.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setShowBorder(true)}
              className={showBorder ? 'button' : 'button secondary'}
              style={{ flex: '1 1 100px' }}
            >
              With border
            </button>
            <button
              type="button"
              onClick={() => setShowBorder(false)}
              className={!showBorder ? 'button' : 'button secondary'}
              style={{ flex: '1 1 100px' }}
            >
              No border
            </button>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <label>QR style</label>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Drop a photo or logo into the middle of the code so it reads at a glance. The QR
            still scans — the high-error-correction setting handles the central hole. Use the
            plain option if you&rsquo;d rather let the plaque&rsquo;s own mark do the branding.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setQrStyle('photo')}
              className={qrStyle === 'photo' ? 'button' : 'button secondary'}
              style={{ flex: '1 1 140px' }}
            >
              With Mary&rsquo;s photo
            </button>
            <button
              type="button"
              onClick={() => setQrStyle('logo')}
              className={qrStyle === 'logo' ? 'button' : 'button secondary'}
              style={{ flex: '1 1 140px' }}
            >
              With site logo
            </button>
            <button
              type="button"
              onClick={() => setQrStyle('standard')}
              className={qrStyle === 'standard' ? 'button' : 'button secondary'}
              style={{ flex: '1 1 140px' }}
            >
              Standard QR
            </button>
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          <label>Mark (top of the plaque)</label>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            By default we use the LiveOnWith.me mark. Replace it with your own logo or crest to
            match your shop&rsquo;s branding. High-contrast silhouettes work best.
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
            >
              {customMarkDataUrl ? 'Replace image' : 'Upload your own image'}
            </button>
            {customMarkDataUrl && (
              <button type="button" className="button secondary" onClick={resetMark}>
                Reset to LiveOnWith.me mark
              </button>
            )}
          </div>
          {markError && (
            <p style={{ color: '#a94442', marginTop: 10, fontSize: 14 }}>{markError}</p>
          )}
        </div>

        <p className="muted" style={{ fontSize: 13, marginTop: 24, wordBreak: 'break-all' }}>
          Scans go to: {target}
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
          <button className="button" onClick={downloadSvg} disabled={!plaqueSvg}>
            Download SVG
          </button>
          <button className="button secondary" onClick={downloadPng} disabled={!plaquePngUrl}>
            Download PNG
          </button>
        </div>

        <div
          style={{
            textAlign: 'left',
            marginTop: 40,
            background: '#fffdf9',
            border: '1px solid var(--line)',
            borderRadius: 14,
            padding: '18px 22px',
          }}
        >
          <h3 style={{ marginTop: 0 }}>How to use this</h3>
          <ul className="muted" style={{ marginTop: 0, paddingLeft: 22 }}>
            <li>Print at A6 or A5 and leave on your counter or in a card holder.</li>
            <li>
              Every design is labelled <strong>&ldquo;{DEMO_LABEL}&rdquo;</strong> so no one
              mistakes it for a real memorial you&rsquo;re managing.
            </li>
            <li>SVG scales to any size without losing sharpness. PNG is simpler for most printers.</li>
            <li>All scans land on the Mary O&rsquo;Donnell demo memorial.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
