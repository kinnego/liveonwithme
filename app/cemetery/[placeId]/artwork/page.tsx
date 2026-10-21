'use client';
// Cemetery artwork — generates downloadable QR codes and designed posters for
// a whole cemetery. The QR points at /cemetery/[placeId], the public page
// listing everyone remembered there. Four flavours:
//
//   - Plain QR (1024x1024) — bare code with the LiveOnWithMe mark centred,
//     for anyone who wants to drop it into their own template.
//   - Sticker (600x600) — square sticker with cemetery name + tagline.
//   - Poster (A4 portrait) — print-ready for notice boards.
//   - Business card (85x51mm) — small handout for family contacts.
//
// Access is restricted to approved partners and super admins. Keepers manage
// individual plots, not the cemetery; cemetery-level signage is a partner /
// admin concern (funeral directors, parish priests, cemetery operators).

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin, isApprovedPartner } from '@/lib/roles';
import type { UserProfile } from '@/lib/types';
import { customIdFromPlaceId, isCustomPlaceId, readCustomCemetery } from '@/lib/cemeteries';
import { qrWithCenteredImage, sameOriginUrlToDataUrl } from '@/lib/qr';
import {
  buildCemeteryCardSvg,
  buildCemeteryPosterSvg,
  buildCemeteryStickerSvg,
  cemeteryArtworkDimensions,
  type CemeteryArtworkVariant,
} from '@/lib/cemetery-artwork';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.liveonwith.me';
const SITE_LOGO_PATH = '/brand/live-on-with-me-logo-512.png';

type CemeteryInfo = {
  name: string;
  address?: string;
};

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

function download(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function downloadSvg(svg: string, filename: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  download(url, filename);
  URL.revokeObjectURL(url);
}

export default function CemeteryArtworkPage({
  params,
  searchParams,
}: {
  params: Promise<{ placeId: string }>;
  searchParams: Promise<{ name?: string; address?: string }>;
}) {
  const { placeId } = use(params);
  const sp = use(searchParams);

  const [access, setAccess] = useState<'checking' | 'denied' | 'ok'>('checking');
  const [info, setInfo] = useState<CemeteryInfo | null>(null);
  const [error, setError] = useState('');

  const [plainQrSvg, setPlainQrSvg] = useState('');
  const [plainQrPng, setPlainQrPng] = useState('');
  const [stickerSvg, setStickerSvg] = useState('');
  const [stickerPng, setStickerPng] = useState('');
  const [posterSvg, setPosterSvg] = useState('');
  const [posterPng, setPosterPng] = useState('');
  const [cardSvg, setCardSvg] = useState('');
  const [cardPng, setCardPng] = useState('');

  const [preview, setPreview] = useState<
    { title: string; svg: string; aspect: string } | null
  >(null);

  const router = useRouter();

  // Escape key closes the full-size preview overlay.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  // Access gate — approved partner or super admin only.
  useEffect(() => {
    if (!auth) {
      setAccess('denied');
      return;
    }
    return onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push(`/auth?next=${encodeURIComponent(`/cemetery/${placeId}/artwork`)}`);
        return;
      }
      try {
        const profSnap = await getDoc(doc(db, 'users', u.uid));
        const prof = profSnap.exists() ? (profSnap.data() as UserProfile) : null;
        if (!isSuperAdmin(prof) && !isApprovedPartner(prof)) {
          setAccess('denied');
          return;
        }
        setAccess('ok');
      } catch (err: any) {
        setError(err?.message || 'Could not check your access.');
        setAccess('denied');
      }
    });
  }, [placeId, router]);

  // Resolve cemetery name/address. Custom cemeteries live in Firestore;
  // Google-indexed cemeteries only exist via placeId + query-string hints
  // from the referring page, so fall back to those.
  useEffect(() => {
    if (access !== 'ok') return;
    (async () => {
      try {
        if (isCustomPlaceId(placeId)) {
          const c = await readCustomCemetery(customIdFromPlaceId(placeId));
          if (c) {
            setInfo({ name: c.name, address: c.address });
            return;
          }
        }
        if (sp.name) {
          setInfo({ name: sp.name, address: sp.address });
          return;
        }
        setInfo({ name: 'This cemetery' });
      } catch (err: any) {
        setError(err?.message || 'Could not load the cemetery.');
      }
    })();
  }, [access, placeId, sp.address, sp.name]);

  // Build the four artwork variants once we know the cemetery details.
  useEffect(() => {
    if (!info) return;
    (async () => {
      try {
        const target = `${SITE_URL}/cemetery/${placeId}`;
        const [standaloneRaw, embeddedRaw, logoDataUrl] = await Promise.all([
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
          sameOriginUrlToDataUrl(SITE_LOGO_PATH).catch(() => ''),
        ]);

        const decorate = (raw: string, idPrefix: string) =>
          logoDataUrl
            ? qrWithCenteredImage({
                qrSvg: raw,
                imageDataUrl: logoDataUrl,
                photoShape: 'circle',
                applyMonoFilter: false,
                idPrefix,
              })
            : raw;

        const standaloneDecorated = decorate(standaloneRaw, 'cemStandalone');
        const embeddedDecorated = decorate(embeddedRaw, 'cemEmbedded');

        setPlainQrSvg(standaloneDecorated);
        try {
          setPlainQrPng(await svgToPngDataUrl(standaloneDecorated, 1024, 1024));
        } catch {
          setPlainQrPng(
            await QRCode.toDataURL(target, {
              width: 1024,
              margin: 2,
              color: { dark: '#000000', light: '#ffffff' },
              errorCorrectionLevel: 'H',
            }),
          );
        }

        const commonInput = {
          qrSvg: embeddedDecorated,
          cemeteryName: info.name,
          address: info.address,
          markDataUrl: logoDataUrl || undefined,
        };

        const sticker = buildCemeteryStickerSvg(commonInput);
        const poster = buildCemeteryPosterSvg(commonInput);
        const card = buildCemeteryCardSvg(commonInput);

        setStickerSvg(sticker);
        setPosterSvg(poster);
        setCardSvg(card);

        const stickerDims = cemeteryArtworkDimensions('sticker');
        const posterDims = cemeteryArtworkDimensions('poster');
        const cardDims = cemeteryArtworkDimensions('card');
        const [sPng, pPng, cPng] = await Promise.all([
          svgToPngDataUrl(sticker, stickerDims.w * 4, stickerDims.h * 4).catch(() => ''),
          svgToPngDataUrl(poster, posterDims.w * 4, posterDims.h * 4).catch(() => ''),
          svgToPngDataUrl(card, cardDims.w * 4, cardDims.h * 4).catch(() => ''),
        ]);
        setStickerPng(sPng);
        setPosterPng(pPng);
        setCardPng(cPng);
      } catch (err: any) {
        setError(err?.message || 'Could not prepare the artwork.');
      }
    })();
  }, [info, placeId]);

  const slug = (info?.name || 'cemetery')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

  if (access === 'checking') {
    return <PageSkeleton variant="detail" label="Loading artwork" />;
  }

  if (access === 'denied') {
    return (
      <main className="shell">
        <div className="formCard center">
          <div className="eyebrow">Cemetery artwork</div>
          <h2>Not available</h2>
          <p className="muted">
            Cemetery QR artwork is for approved partners (funeral directors, parish
            priests, cemetery operators) and site admins. If you look after a plot
            at this cemetery, you can download artwork for that plot from the plot
            page.
          </p>
          <Link href="/dashboard" className="button" style={{ marginTop: 20 }}>
            Back to your dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="shell">
        <div className="formCard center">
          <div className="eyebrow">Cemetery artwork</div>
          <h2>Could not load artwork</h2>
          <p className="muted">{error}</p>
          <Link href={`/cemetery/${placeId}`} className="button" style={{ marginTop: 20 }}>
            Back to the cemetery
          </Link>
        </div>
      </main>
    );
  }

  if (!info || !plainQrSvg) {
    return <PageSkeleton variant="detail" label="Preparing artwork" />;
  }

  const variants: {
    key: CemeteryArtworkVariant | 'qr';
    title: string;
    blurb: string;
    svg: string;
    png: string;
    aspect: string;
  }[] = [
    {
      key: 'qr',
      title: 'Plain QR',
      blurb: 'Just the code with our mark in the centre. Drop it into your own template, stamp, or embroidery design.',
      svg: plainQrSvg,
      png: plainQrPng,
      aspect: '1 / 1',
    },
    {
      key: 'sticker',
      title: 'Square sticker',
      blurb: 'Vinyl-friendly sticker with the cemetery name — stick it on noticeboards, information lecterns, or office doors.',
      svg: stickerSvg,
      png: stickerPng,
      aspect: '1 / 1',
    },
    {
      key: 'poster',
      title: 'A4 poster',
      blurb: 'Print-ready for a cemetery noticeboard or church porch.',
      svg: posterSvg,
      png: posterPng,
      aspect: '595 / 842',
    },
    {
      key: 'card',
      title: 'Business card',
      blurb: 'Hand it to a family at the end of a service.',
      svg: cardSvg,
      png: cardPng,
      aspect: '350 / 200',
    },
  ];

  return (
    <main className="shell">
      <div style={{ marginBottom: 14 }}>
        <Link href={`/cemetery/${placeId}`} className="button secondary small">
          Back to the cemetery
        </Link>
      </div>
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Cemetery artwork</div>
          <h2 style={{ marginBottom: 4 }}>{info.name}</h2>
          {info.address && (
            <p className="muted" style={{ margin: 0 }}>
              {info.address}
            </p>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24, background: '#fffdf9' }}>
        <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
          Each code points to <strong style={{ color: 'var(--ink)' }}>{SITE_URL}/cemetery/{placeId}</strong>, the page
          listing everyone remembered at this cemetery. The page stays current as new memorials are added, so printed signage
          doesn&rsquo;t go stale.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 720, margin: '0 auto' }}>
        {variants.map((v) => (
          <article key={v.key} className="card">
            <h3 style={{ margin: '0 0 6px' }}>{v.title}</h3>
            <p className="muted" style={{ margin: '0 0 16px', fontSize: 13, lineHeight: 1.55 }}>
              {v.blurb}
            </p>
            <button
              type="button"
              onClick={() => setPreview({ title: v.title, svg: v.svg, aspect: v.aspect })}
              aria-label={`Open a larger preview of the ${v.title.toLowerCase()}`}
              style={{
                display: 'block',
                width: '100%',
                aspectRatio: v.aspect,
                background: '#f7f4ee',
                borderRadius: 12,
                border: '1px solid var(--line)',
                overflow: 'hidden',
                marginBottom: 14,
                padding: 14,
                cursor: 'zoom-in',
              }}
            >
              <div
                style={{ width: '100%', height: '100%' }}
                dangerouslySetInnerHTML={{ __html: v.svg }}
              />
            </button>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="button secondary small"
                onClick={() =>
                  downloadSvg(v.svg, `cemetery-${slug}-${v.key}.svg`)
                }
              >
                Download SVG
              </button>
              <button
                type="button"
                className="button secondary small"
                onClick={() => v.png && download(v.png, `cemetery-${slug}-${v.key}.png`)}
                disabled={!v.png}
                aria-disabled={!v.png}
              >
                Download PNG
              </button>
            </div>
          </article>
        ))}
      </div>

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${preview.title} full preview`}
          onClick={() => setPreview(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(22,30,27,.78)',
            zIndex: 100,
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            cursor: 'zoom-out',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--paper)',
              borderRadius: 16,
              padding: 20,
              maxWidth: 'min(900px, 92vw)',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <h3 style={{ margin: 0 }}>{preview.title}</h3>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="button secondary small"
                aria-label="Close preview"
              >
                Close
              </button>
            </div>
            <div
              style={{
                aspectRatio: preview.aspect,
                background: '#f7f4ee',
                borderRadius: 12,
                border: '1px solid var(--line)',
                overflow: 'hidden',
                padding: 16,
                maxHeight: 'calc(92vh - 100px)',
              }}
            >
              <div
                style={{ width: '100%', height: '100%' }}
                dangerouslySetInnerHTML={{ __html: preview.svg }}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
