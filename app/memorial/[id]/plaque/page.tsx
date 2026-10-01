'use client';
// Memorial plaque designer — a personal keepsake plaque for a single memorial.
// Mirrors the demo-qr designer: shape, orientation (oval only), border, bottom
// text, and a QR-centre toggle that can embed either the memorial's own hero
// photo, the LiveOnWith.me mark, or nothing. There's also a "just the QR" mode
// that drops the top mark and lets the QR grow into its place — handy if a
// family just wants a clean QR card without any surrounding chrome. No
// persistence for now: users design on each visit and download the result.

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import type { Memorial, PlaqueShape, PlaqueOrientation, UserProfile } from '@/lib/types';
import {
  buildPlaqueSvg,
  DEFAULT_PLAQUE_SHAPE,
  DEFAULT_PLAQUE_ORIENTATION,
  MAX_BOTTOM_TEXT_LEN,
  plaqueDimensions,
} from '@/lib/plaque';
import { qrWithCenteredImage, sameOriginUrlToDataUrl } from '@/lib/qr';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.liveonwith.me';
const MAX_PHOTO_BYTES = 4_000_000;
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

type Access = 'checking' | 'denied' | 'ok' | 'not_found';
type QrCentre = 'photo' | 'logo' | 'none';
type PhotoShape = 'circle' | 'square';

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function fetchHeroPhotoDataUrl(memorialId: string): Promise<string | null> {
  if (!auth.currentUser) return null;
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(
    `/api/memorial/hero-photo?memorialId=${encodeURIComponent(memorialId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
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

export default function MemorialPlaquePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [access, setAccess] = useState<Access>('checking');
  const [memorial, setMemorial] = useState<Memorial | null>(null);

  const [shape, setShape] = useState<PlaqueShape>(DEFAULT_PLAQUE_SHAPE);
  const [orientation, setOrientation] = useState<PlaqueOrientation>(DEFAULT_PLAQUE_ORIENTATION);
  const [showBorder, setShowBorder] = useState(true);
  const [qrOnly, setQrOnly] = useState(false);
  const [qrCentre, setQrCentre] = useState<QrCentre>('photo');
  const [photoShape, setPhotoShape] = useState<PhotoShape>('circle');
  const [bottomText, setBottomText] = useState('');

  const [qrSvg, setQrSvg] = useState('');
  const [siteLogoDataUrl, setSiteLogoDataUrl] = useState('');
  const [heroPhotoDataUrl, setHeroPhotoDataUrl] = useState<string | null>(null);
  // In-browser override — upload a different picture just for the plaque
  // without touching the memorial's hero photo. Not persisted; refreshing the
  // page restores the hero photo.
  const [customPhotoDataUrl, setCustomPhotoDataUrl] = useState<string | null>(null);
  const [photoUploadError, setPhotoUploadError] = useState('');
  // Custom top-of-plaque mark — replaces the LiveOnWith.me logo at the top of
  // the plaque. Same ephemeral/in-browser treatment as the custom photo above.
  const [customMarkDataUrl, setCustomMarkDataUrl] = useState<string | null>(null);
  const [markUploadError, setMarkUploadError] = useState('');
  const [plaqueSvg, setPlaqueSvg] = useState('');
  const [plaquePngUrl, setPlaquePngUrl] = useState('');

  const photoInputRef = useRef<HTMLInputElement>(null);
  const markInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Load memorial + access check.
  useEffect(() => {
    params.then(({ id }) => {
      if (!auth) return;
      return onAuthStateChanged(auth, async (u) => {
        if (!u) return router.push('/auth');
        try {
          const memSnap = await getDoc(doc(db, 'memorials', id));
          if (!memSnap.exists()) {
            setAccess('not_found');
            return;
          }
          const m = { id: memSnap.id, ...(memSnap.data() as Omit<Memorial, 'id'>) };
          const profSnap = await getDoc(doc(db, 'users', u.uid));
          const prof = profSnap.exists() ? (profSnap.data() as UserProfile) : null;
          const allowed =
            m.ownerId === u.uid ||
            (m.successorUids || []).includes(u.uid) ||
            isSuperAdmin(prof);
          if (!allowed) {
            setMemorial(m);
            setAccess('denied');
            return;
          }
          setMemorial(m);
          setBottomText((m.fullName || '').slice(0, MAX_BOTTOM_TEXT_LEN));
          setAccess('ok');
        } catch {
          setAccess('denied');
        }
      });
    });
  }, [params, router]);

  // Prepare the shared bits once access is granted: QR, site logo, and hero
  // photo (if the memorial has one). All loaded once; later toggles reuse
  // these without re-fetching.
  useEffect(() => {
    if (access !== 'ok' || !memorial) return;
    let cancelled = false;
    (async () => {
      try {
        const target = `${SITE_URL}/m/${memorial.slug}`;
        const [qr, logo, heroPhoto] = await Promise.all([
          QRCode.toString(target, {
            type: 'svg',
            margin: 0,
            color: { dark: '#000000', light: '#ffffff' },
            errorCorrectionLevel: 'H',
          }),
          sameOriginUrlToDataUrl('/brand/live-on-with-me-logo-512.png'),
          memorial.heroPhotoPath ? fetchHeroPhotoDataUrl(memorial.id) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setQrSvg(qr);
        setSiteLogoDataUrl(logo);
        setHeroPhotoDataUrl(heroPhoto);
        // No hero photo on file? Default the QR centre to the site logo so
        // the first render is useful without the family picking anything.
        if (!heroPhoto) setQrCentre('logo');
      } catch {
        /* preview will stay blank until the user interacts */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [access, memorial]);

  // Rebuild the plaque whenever any input changes.
  useEffect(() => {
    if (!qrSvg || !siteLogoDataUrl) return;
    const activePhoto = customPhotoDataUrl || heroPhotoDataUrl;
    let qrForPlaque = qrSvg;
    if (qrCentre === 'photo' && activePhoto) {
      qrForPlaque = qrWithCenteredImage({
        qrSvg,
        imageDataUrl: activePhoto,
        photoShape,
        applyMonoFilter: true,
        idPrefix: 'memPhoto',
      });
    } else if (qrCentre === 'logo') {
      qrForPlaque = qrWithCenteredImage({
        qrSvg,
        imageDataUrl: siteLogoDataUrl,
        photoShape,
        applyMonoFilter: false,
        idPrefix: 'memLogo',
      });
    }
    const markDataUrl = customMarkDataUrl || siteLogoDataUrl;
    const svg = buildPlaqueSvg({
      shape,
      orientation,
      qrSvg: qrForPlaque,
      markDataUrl,
      bottomText,
      showBorder,
      qrOnly,
    });
    setPlaqueSvg(svg);
    const { w, h } = plaqueDimensions(shape, orientation);
    renderSvgToPngDataUrl(svg, w * 4, h * 4)
      .then(setPlaquePngUrl)
      .catch(() => setPlaquePngUrl(''));
  }, [
    qrSvg,
    siteLogoDataUrl,
    heroPhotoDataUrl,
    customPhotoDataUrl,
    customMarkDataUrl,
    shape,
    orientation,
    showBorder,
    qrOnly,
    qrCentre,
    photoShape,
    bottomText,
  ]);

  async function uploadPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoUploadError('');
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoUploadError('That image is a little big — please choose one under 4 MB.');
      if (photoInputRef.current) photoInputRef.current.value = '';
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setCustomPhotoDataUrl(dataUrl);
      // Switching the centre to the photo variant is almost always what the
      // user wants after uploading — otherwise the upload would silently do
      // nothing.
      setQrCentre('photo');
    } catch {
      setPhotoUploadError("Couldn't read that image. Try a PNG, JPG or WEBP.");
    } finally {
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  function resetPhoto() {
    setCustomPhotoDataUrl(null);
    setPhotoUploadError('');
    // Memorial has no hero photo to fall back on — swap the QR centre to the
    // site mark so the UI doesn't show "photo" selected over a disabled button.
    if (!heroPhotoDataUrl) setQrCentre('logo');
  }

  async function uploadMark(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMarkUploadError('');
    if (file.size > MAX_MARK_BYTES) {
      setMarkUploadError('That image is a little big — please choose one under 1.5 MB.');
      if (markInputRef.current) markInputRef.current.value = '';
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setCustomMarkDataUrl(dataUrl);
    } catch {
      setMarkUploadError("Couldn't read that image. Try a PNG, JPG, WEBP or SVG.");
    } finally {
      if (markInputRef.current) markInputRef.current.value = '';
    }
  }

  function resetMark() {
    setCustomMarkDataUrl(null);
    setMarkUploadError('');
  }

  function filenameBase(ext: string) {
    const slug = memorial?.slug || 'memorial';
    const shapeTag = shape === 'oval' ? `${shape}-${orientation}` : shape;
    const centreTag = qrCentre === 'photo' && heroPhotoDataUrl ? 'photo' : qrCentre;
    const layoutTag = qrOnly ? '-qr-only' : '';
    return `${slug}-plaque-${shapeTag}-${centreTag}${layoutTag}.${ext}`;
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
    return <PageSkeleton variant="detail" label="Preparing your plaque" />;
  }

  if (access === 'not_found') {
    return (
      <main className="shell">
        <div className="formCard center">
          <div className="eyebrow">Memorial plaque</div>
          <h2>We couldn&rsquo;t find that memorial.</h2>
          <Link href="/dashboard" className="button" style={{ marginTop: 20 }}>
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (access === 'denied') {
    return (
      <main className="shell">
        <div className="formCard center">
          <div className="eyebrow">Memorial plaque</div>
          <h2>Only the memorial&rsquo;s custodian can design the plaque.</h2>
          {memorial && (
            <Link href={`/m/${memorial.slug}`} className="button" style={{ marginTop: 20 }}>
              View the memorial
            </Link>
          )}
        </div>
      </main>
    );
  }

  if (!qrSvg || !siteLogoDataUrl || !memorial) {
    return <PageSkeleton variant="detail" label="Preparing your plaque" />;
  }

  const isLandscape = shape === 'oval' && orientation === 'landscape';
  const previewMaxWidth = isLandscape ? 460 : shape === 'oval' ? 320 : 380;
  const target = `${SITE_URL}/m/${memorial.slug}`;
  const activePhotoUrl = customPhotoDataUrl || heroPhotoDataUrl;
  const hasPhoto = Boolean(activePhotoUrl);

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">Memorial plaque</div>
        <h2>A keepsake plaque for {memorial.fullName}</h2>
        <p className="muted">
          Design a plaque that links straight to {memorial.fullName}&rsquo;s memorial page. Lovely
          for a mantelpiece, a prayer card, a wake remembrance, or wherever feels right. If a hero
          photo is set we&rsquo;ll offer to place it in the centre of the QR; otherwise the
          LiveOnWith.me mark steps in.
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
          <label>Layout</label>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            &ldquo;Full plaque&rdquo; includes the LiveOnWith.me mark at the top. &ldquo;Just the
            QR&rdquo; drops it so the QR fills the space — cleaner for a prayer-card insert or a
            simple fridge magnet.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setQrOnly(false)}
              className={!qrOnly ? 'button' : 'button secondary'}
              style={{ flex: '1 1 140px' }}
            >
              Full plaque
            </button>
            <button
              type="button"
              onClick={() => setQrOnly(true)}
              className={qrOnly ? 'button' : 'button secondary'}
              style={{ flex: '1 1 140px' }}
            >
              Just the QR
            </button>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <label>Border</label>
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
              onClick={() => setQrCentre('photo')}
              className={qrCentre === 'photo' ? 'button' : 'button secondary'}
              disabled={!hasPhoto}
              style={{ flex: '1 1 140px', opacity: hasPhoto ? 1 : 0.55 }}
            >
              {hasPhoto
                ? `With ${memorial.fullName.split(' ')[0]}'s photo`
                : 'No photo on file'}
            </button>
            <button
              type="button"
              onClick={() => setQrCentre('logo')}
              className={qrCentre === 'logo' ? 'button' : 'button secondary'}
              style={{ flex: '1 1 140px' }}
            >
              With site logo
            </button>
            <button
              type="button"
              onClick={() => setQrCentre('none')}
              className={qrCentre === 'none' ? 'button' : 'button secondary'}
              style={{ flex: '1 1 140px' }}
            >
              Standard QR
            </button>
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
              {hasPhoto
                ? 'Use a different picture for the plaque'
                : 'Upload a picture to place in the centre of the QR'}
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 8 }}>
              {hasPhoto
                ? "The memorial's hero photo is used by default. Upload a tighter crop or a different picture if that one isn't quite right for the plaque. Just for the plaque — the memorial page is unchanged."
                : "There's no hero photo on this memorial yet. Upload one here and we'll use it in the centre of the QR."}
            </p>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={uploadPhoto}
              style={{ display: 'none' }}
            />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="button secondary"
                onClick={() => photoInputRef.current?.click()}
              >
                {customPhotoDataUrl ? 'Replace photo' : 'Upload a photo'}
              </button>
              {customPhotoDataUrl && (
                <button type="button" className="button secondary" onClick={resetPhoto}>
                  Reset to hero photo
                </button>
              )}
            </div>
            {photoUploadError && (
              <p style={{ color: '#a94442', marginTop: 10, fontSize: 14 }}>{photoUploadError}</p>
            )}
          </div>

          {qrCentre === 'photo' && hasPhoto && (
            <div style={{ marginTop: 14 }}>
              <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
                Photo shape
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setPhotoShape('circle')}
                  className={photoShape === 'circle' ? 'button' : 'button secondary'}
                  style={{ flex: '1 1 100px' }}
                >
                  Circle
                </button>
                <button
                  type="button"
                  onClick={() => setPhotoShape('square')}
                  className={photoShape === 'square' ? 'button' : 'button secondary'}
                  style={{ flex: '1 1 100px' }}
                >
                  Square
                </button>
              </div>
            </div>
          )}
        </div>

        {!qrOnly && (
          <div style={{ marginTop: 24 }}>
            <label>Mark (top of the plaque)</label>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              By default we use the LiveOnWith.me mark. Replace it with your own image — a family
              crest, a cross, a rose, anything that feels right. High-contrast silhouettes engrave
              best.
            </p>
            <input
              ref={markInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={uploadMark}
              style={{ display: 'none' }}
            />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              <button
                type="button"
                className="button secondary"
                onClick={() => markInputRef.current?.click()}
              >
                {customMarkDataUrl ? 'Replace image' : 'Upload your own image'}
              </button>
              {customMarkDataUrl && (
                <button type="button" className="button secondary" onClick={resetMark}>
                  Reset to LiveOnWith.me mark
                </button>
              )}
            </div>
            {markUploadError && (
              <p style={{ color: '#a94442', marginTop: 10, fontSize: 14 }}>{markUploadError}</p>
            )}
          </div>
        )}

        <div style={{ marginTop: 24 }}>
          <label htmlFor="bottomText">Bottom text (optional)</label>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            A short line engraved beneath the QR. Leave blank for no text.
          </p>
          <input
            id="bottomText"
            type="text"
            value={bottomText}
            onChange={(e) => setBottomText(e.target.value)}
            placeholder={memorial.fullName}
            maxLength={MAX_BOTTOM_TEXT_LEN}
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 6, textAlign: 'right' }}>
            {bottomText.length}/{MAX_BOTTOM_TEXT_LEN}
          </p>
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

        <div style={{ marginTop: 30, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href={`/memorial/${memorial.id}/manage`} className="button soft">
            Back to manage
          </Link>
          <Link href={`/m/${memorial.slug}`} className="button soft">
            View memorial
          </Link>
        </div>
      </div>
    </main>
  );
}
