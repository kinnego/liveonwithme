'use client';
// Memorial artwork — the one place to grab QR/plaque art for a single person.
// Plain QR mode gives a bare code (with their photo in the centre if we have
// one) for prayer cards, pendants, shop keepsakes. Full plaque mode is the
// framed version with shape, border, text, and more control over the centre.
// Nothing persists; downloads are the output. One URL replaces the earlier
// /memorial/[id]/qr and /memorial/[id]/plaque pages.

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { auth, db } from '@/lib/firebase';
import { canEditMemorial, isSuperAdmin } from '@/lib/roles';
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

type Mode = 'qr' | 'plaque';
type Access = 'checking' | 'denied' | 'ok' | 'not_found';
type QrCentre = 'photo' | 'logo' | 'none';
type PhotoShape = 'circle' | 'square';

const SHAPE_OPTIONS: { value: PlaqueShape; label: string }[] = [
  { value: 'oval', label: 'Oval' },
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' },
];

const ORIENTATION_OPTIONS: { value: PlaqueOrientation; label: string }[] = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

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

export default function MemorialArtworkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [access, setAccess] = useState<Access>('checking');
  const [memorial, setMemorial] = useState<Memorial | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mode, setMode] = useState<Mode>('plaque');

  const [standaloneQrRaw, setStandaloneQrRaw] = useState('');
  const [embeddedQrRaw, setEmbeddedQrRaw] = useState('');
  const [siteLogoDataUrl, setSiteLogoDataUrl] = useState('');
  const [heroPhotoDataUrl, setHeroPhotoDataUrl] = useState<string | null>(null);

  const [standaloneQrSvg, setStandaloneQrSvg] = useState('');
  const [standaloneQrPng, setStandaloneQrPng] = useState('');

  // Plaque state.
  const [shape, setShape] = useState<PlaqueShape>(DEFAULT_PLAQUE_SHAPE);
  const [orientation, setOrientation] = useState<PlaqueOrientation>(DEFAULT_PLAQUE_ORIENTATION);
  const [showBorder, setShowBorder] = useState(true);
  const [qrOnly, setQrOnly] = useState(false);
  const [qrCentre, setQrCentre] = useState<QrCentre>('photo');
  const [photoShape, setPhotoShape] = useState<PhotoShape>('circle');
  const [bottomText, setBottomText] = useState('');

  // Ephemeral overrides — upload a different picture / mark just for the
  // plaque without touching the memorial itself.
  const [customPhotoDataUrl, setCustomPhotoDataUrl] = useState<string | null>(null);
  const [photoUploadError, setPhotoUploadError] = useState('');
  const [customMarkDataUrl, setCustomMarkDataUrl] = useState<string | null>(null);
  const [markUploadError, setMarkUploadError] = useState('');

  const [plaqueSvg, setPlaqueSvg] = useState('');
  const [plaquePngUrl, setPlaquePngUrl] = useState('');

  const photoInputRef = useRef<HTMLInputElement>(null);
  const markInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const m = searchParams.get('mode');
    if (m === 'qr' || m === 'plaque') setMode(m);
  }, [searchParams]);

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
          const admin = isSuperAdmin(prof);
          const allowed =
            canEditMemorial(u.uid, m) ||
            (m.successorUids || []).includes(u.uid) ||
            m.partnerUid === u.uid ||
            admin;
          if (!allowed) {
            setMemorial(m);
            setAccess('denied');
            return;
          }
          setMemorial(m);
          setIsAdmin(admin);
          setBottomText((m.fullName || '').slice(0, MAX_BOTTOM_TEXT_LEN));
          setAccess('ok');
        } catch {
          setAccess('denied');
        }
      });
    });
  }, [params, router]);

  // Load the shared bits once access is granted: QR source SVGs, site logo,
  // hero photo. Later toggles reuse these without re-fetching.
  useEffect(() => {
    if (access !== 'ok' || !memorial) return;
    let cancelled = false;
    (async () => {
      try {
        const target = `${SITE_URL}/m/${memorial.slug}`;
        const [standaloneRaw, embeddedRaw, logo, heroPhoto] = await Promise.all([
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
          sameOriginUrlToDataUrl('/brand/live-on-with-me-logo-512.png'),
          memorial.heroPhotoPath ? fetchHeroPhotoDataUrl(memorial.id) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setStandaloneQrRaw(standaloneRaw);
        setEmbeddedQrRaw(embeddedRaw);
        setSiteLogoDataUrl(logo);
        setHeroPhotoDataUrl(heroPhoto);
        if (!heroPhoto) setQrCentre('logo');
      } catch {
        /* preview will stay blank until the user interacts */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [access, memorial]);

  // Build the standalone QR (Plain QR mode output). Always decorated — hero
  // in the centre if present, otherwise the site logo.
  useEffect(() => {
    if (!standaloneQrRaw) return;
    const activePhoto = customPhotoDataUrl || heroPhotoDataUrl;
    const decorated = activePhoto
      ? qrWithCenteredImage({
          qrSvg: standaloneQrRaw,
          imageDataUrl: activePhoto,
          photoShape: 'circle',
          applyMonoFilter: true,
          idPrefix: 'memQrHero',
        })
      : siteLogoDataUrl
        ? qrWithCenteredImage({
            qrSvg: standaloneQrRaw,
            imageDataUrl: siteLogoDataUrl,
            photoShape: 'circle',
            applyMonoFilter: false,
            idPrefix: 'memQrLogo',
          })
        : standaloneQrRaw;
    setStandaloneQrSvg(decorated);
    svgToPngDataUrl(decorated, 1024, 1024)
      .then(setStandaloneQrPng)
      .catch(() => {
        if (!memorial) return;
        const target = `${SITE_URL}/m/${memorial.slug}`;
        QRCode.toDataURL(target, {
          width: 1024,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
          errorCorrectionLevel: 'H',
        }).then(setStandaloneQrPng).catch(() => setStandaloneQrPng(''));
      });
  }, [standaloneQrRaw, heroPhotoDataUrl, customPhotoDataUrl, siteLogoDataUrl, memorial]);

  // Rebuild the plaque whenever any input changes.
  useEffect(() => {
    if (!embeddedQrRaw || !siteLogoDataUrl) return;
    const activePhoto = customPhotoDataUrl || heroPhotoDataUrl;
    let qrForPlaque = embeddedQrRaw;
    if (qrCentre === 'photo' && activePhoto) {
      qrForPlaque = qrWithCenteredImage({
        qrSvg: embeddedQrRaw,
        imageDataUrl: activePhoto,
        photoShape,
        applyMonoFilter: true,
        idPrefix: 'memPhoto',
      });
    } else if (qrCentre === 'logo') {
      qrForPlaque = qrWithCenteredImage({
        qrSvg: embeddedQrRaw,
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
    svgToPngDataUrl(svg, w * 4, h * 4)
      .then(setPlaquePngUrl)
      .catch(() => setPlaquePngUrl(''));
  }, [
    embeddedQrRaw,
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

  function plaqueFilename(ext: string) {
    const slug = memorial?.slug || 'memorial';
    const shapeTag = shape === 'oval' ? `${shape}-${orientation}` : shape;
    const centreTag = qrCentre === 'photo' && (customPhotoDataUrl || heroPhotoDataUrl) ? 'photo' : qrCentre;
    const layoutTag = qrOnly ? '-qr-only' : '';
    return `${slug}-plaque-${shapeTag}-${centreTag}${layoutTag}.${ext}`;
  }

  function downloadQrSvg() {
    if (!standaloneQrSvg || !memorial) return;
    const blob = new Blob([standaloneQrSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${memorial.slug}-qr.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadQrPng() {
    if (!standaloneQrPng || !memorial) return;
    const a = document.createElement('a');
    a.href = standaloneQrPng;
    a.download = `${memorial.slug}-qr.png`;
    a.click();
  }

  function downloadPlaqueSvg() {
    if (!plaqueSvg) return;
    const blob = new Blob([plaqueSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = plaqueFilename('svg');
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPlaquePng() {
    if (!plaquePngUrl) return;
    const a = document.createElement('a');
    a.href = plaquePngUrl;
    a.download = plaqueFilename('png');
    a.click();
  }

  if (access === 'checking') {
    return <PageSkeleton variant="detail" label="Preparing your artwork" />;
  }

  if (access === 'not_found') {
    return (
      <main className="shell">
        <div className="formCard center">
          <div className="eyebrow">For a keepsake</div>
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
          <div className="eyebrow">For a keepsake</div>
          <h2>Only the memorial&rsquo;s custodian can design artwork.</h2>
          {memorial && (
            <Link href={`/m/${memorial.slug}`} className="button" style={{ marginTop: 20 }}>
              View the memorial
            </Link>
          )}
        </div>
      </main>
    );
  }

  if (!embeddedQrRaw || !siteLogoDataUrl || !memorial) {
    return <PageSkeleton variant="detail" label="Preparing your artwork" />;
  }

  const isLandscape = shape === 'oval' && orientation === 'landscape';
  const previewMaxWidth = isLandscape ? 460 : shape === 'oval' ? 320 : 380;
  const target = `${SITE_URL}/m/${memorial.slug}`;
  const activePhotoUrl = customPhotoDataUrl || heroPhotoDataUrl;
  const hasPhoto = Boolean(activePhotoUrl);
  const isPaid =
    memorial.paymentStatus === 'paid' ||
    memorial.paymentStatus === 'paid_via_partner' ||
    memorial.paymentStatus === 'paid_via_gift';
  const canDownload = isPaid || isAdmin;

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">For a keepsake</div>
        <h2>Artwork for {memorial.fullName}</h2>
        <p className="muted">
          A personal plaque or QR card for one person — mantelpiece, prayer card, pendant, memory
          box or a keepsake sold in a shop. Scans go straight to {memorial.fullName}&rsquo;s page,
          not the plot.
        </p>
        {memorial.plotId && (
          <p className="muted" style={{ fontSize: 13 }}>
            Looking for the artwork for the resting place (headstone, bench, columbarium…)?
            That&rsquo;s the{' '}
            <Link
              href={`/plot/${memorial.plotId}/artwork`}
              style={{ color: 'var(--brand)', textDecoration: 'underline' }}
            >
              plot artwork
            </Link>
            {' '}— it links to the plot so every name there is reachable from one code.
          </p>
        )}

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
              The bare QR — with {memorial.fullName.split(' ')[0]}&rsquo;s photo in the centre if
              we have one. Clean and simple for pendants, prayer cards or shop keepsakes.
            </p>
            {standaloneQrSvg ? (
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
            ) : (
              <div
                style={{
                  margin: '24px auto',
                  maxWidth: 340,
                  aspectRatio: '1 / 1',
                  borderRadius: 16,
                  border: '1px solid var(--line)',
                  background: '#f7f4ee',
                }}
              />
            )}
            <p className="muted" style={{ fontSize: 13, wordBreak: 'break-all', textAlign: 'center' }}>
              {target}
            </p>
            {!canDownload && (
              <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 20 }}>
                Downloads unlock once this memorial is paid for and live.{' '}
                <Link
                  href={`/memorial/${memorial.id}/manage`}
                  style={{ color: 'var(--brand)', textDecoration: 'underline' }}
                >
                  Open manage to publish
                </Link>
                .
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
              <button
                className="button"
                onClick={downloadQrSvg}
                disabled={!canDownload || !standaloneQrSvg}
                title={!canDownload ? 'Downloads unlock once the memorial is paid for.' : undefined}
              >
                Download SVG
              </button>
              <button
                className="button secondary"
                onClick={downloadQrPng}
                disabled={!canDownload || !standaloneQrPng}
                title={!canDownload ? 'Downloads unlock once the memorial is paid for.' : undefined}
              >
                Download PNG
              </button>
            </div>
          </>
        )}

        {mode === 'plaque' && (
          <>
            <p className="muted" style={{ marginTop: 20, fontSize: 14 }}>
              The framed version — shape, border, your choice of mark on top, optional text
              underneath, and more control over what sits in the centre of the QR.
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
                &ldquo;Full plaque&rdquo; includes the mark at the top. &ldquo;QR fills the
                plaque&rdquo; drops the mark so the code is bigger — cleaner for a prayer-card
                insert or a simple fridge magnet.
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
                  QR fills the plaque
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
                still scans — the high-error-correction setting handles the central hole.
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
                  By default we use the LiveOnWith.me mark. Replace it with a family crest, cross,
                  rose or anything that feels right. High-contrast silhouettes reproduce best.
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
                A short line beneath the QR. Leave blank for no text.
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

            {!canDownload && (
              <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 20 }}>
                Downloads unlock once this memorial is paid for and live.{' '}
                <Link
                  href={`/memorial/${memorial.id}/manage`}
                  style={{ color: 'var(--brand)', textDecoration: 'underline' }}
                >
                  Open manage to publish
                </Link>
                .
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
              <button
                className="button"
                onClick={downloadPlaqueSvg}
                disabled={!canDownload || !plaqueSvg}
                title={!canDownload ? 'Downloads unlock once the memorial is paid for.' : undefined}
              >
                Download SVG
              </button>
              <button
                className="button secondary"
                onClick={downloadPlaquePng}
                disabled={!canDownload || !plaquePngUrl}
                title={!canDownload ? 'Downloads unlock once the memorial is paid for.' : undefined}
              >
                Download PNG
              </button>
            </div>
          </>
        )}

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
