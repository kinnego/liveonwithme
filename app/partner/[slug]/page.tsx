// Public partner page. Opt-out by default — any approved partner gets
// /partner/<slug>, and small firms without a website use it as their one
// web presence. Server-rendered so the QR code they print always resolves
// to something search-engine-visible without client-side hydration.

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import ButtonLink from '@/components/ButtonLink';
import PartnerPublicPageEditor from '@/components/PartnerPublicPageEditor';
import { adminDb } from '@/lib/firebase-admin';
import { PARTNER_TYPE_LABELS, PartnerType, UserProfile } from '@/lib/types';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.liveonwith.me';
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';

// Lifestyle photos in /public/demo. Used as a per-partner default hero when
// the partner hasn't uploaded one — picked deterministically from the uid so
// each firm keeps the same image across visits.
const LIFESTYLE_COUNT = 12;

function lifestyleHeroFor(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  const n = (hash % LIFESTYLE_COUNT) + 1;
  return `/demo/liveonwithme_lifestyle_${String(n).padStart(2, '0')}.webp`;
}

export const dynamic = 'force-dynamic';

type Cemetery = { placeId: string; name: string };

type LoadedPartner = {
  uid: string;
  slug: string;
  businessName: string;
  partnerType: PartnerType | null;
  blurb: string;
  website: string;
  phone: string;
  showPhone: boolean;
  showEmail: boolean;
  email: string;
  heroPhotoUrl: string;
  heroPhotoIsCustom: boolean;
  cemeteries: Cemetery[];
};

async function loadPartner(slug: string): Promise<LoadedPartner | null> {
  try {
    const snap = await adminDb()
      .collection('users')
      .where('partnerSlug', '==', slug)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    const data = doc.data() as UserProfile;

    // Super admins can run a demo /partner/<slug> page off their own account
    // (same partner fields, different role) — useful for showing prospects
    // what a page looks like without creating a fake partner. For a real
    // partner, both the role and an 'approved' partnerStatus are required.
    const isSuperAdmin = data.role === 'super_admin';
    if (data.role !== 'partner' && !isSuperAdmin) return null;
    if (!isSuperAdmin && data.partnerStatus !== 'approved') return null;
    // partnerPublic is treated as true when undefined — opt-out, not opt-in.
    if (data.partnerPublic === false) return null;

    const cemeteries = await loadCemeteries(doc.id);

    const customHero = data.partnerHeroPhotoPath && R2_PUBLIC_URL
      ? `${R2_PUBLIC_URL}/${data.partnerHeroPhotoPath}`
      : '';

    return {
      uid: doc.id,
      slug,
      businessName: data.partnerBusinessName || data.displayName || 'Partner',
      partnerType: (data.partnerType as PartnerType | undefined) ?? null,
      blurb: data.partnerBlurb || '',
      website: data.partnerWebsite || '',
      phone: data.partnerPhone || '',
      showPhone: data.partnerShowPhone === true,
      showEmail: data.partnerShowEmail === true,
      email: data.email || '',
      heroPhotoUrl: customHero || lifestyleHeroFor(doc.id),
      heroPhotoIsCustom: !!customHero,
      cemeteries,
    };
  } catch {
    return null;
  }
}

async function loadCemeteries(uid: string): Promise<Cemetery[]> {
  // Derived from graveRecords the partner has added via /partner/register.
  // Memorials route through plots (one extra hop per memorial) and partners
  // may work at private plots that aren't cemeteries — graveRecords are the
  // cleaner signal for "cemeteries this firm serves."
  try {
    const snap = await adminDb()
      .collection('graveRecords')
      .where('createdByUid', '==', uid)
      .where('source', '==', 'partner')
      .limit(500)
      .get();
    const byPlace = new Map<string, Cemetery>();
    for (const d of snap.docs) {
      const data = d.data() as any;
      const c = data?.cemetery;
      if (!c?.placeId || !c?.name) continue;
      if (!byPlace.has(c.placeId)) {
        byPlace.set(c.placeId, { placeId: c.placeId, name: c.name });
      }
    }
    return Array.from(byPlace.values()).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = await loadPartner(slug);
  if (!p) {
    return {
      title: 'Partner · LiveOnWith.me',
      robots: { index: false, follow: false },
    };
  }
  const typeLabel = p.partnerType ? PARTNER_TYPE_LABELS[p.partnerType] : 'Partner';
  const title = `${p.businessName} · ${typeLabel}`;
  const description =
    p.blurb ||
    `${p.businessName} works with families through LiveOnWith.me to set up lasting online memorials.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: `${SITE_URL}/partner/${slug}`,
    },
    alternates: { canonical: `${SITE_URL}/partner/${slug}` },
  };
}

export default async function PartnerPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const p = await loadPartner(slug);
  if (!p) notFound();

  const typeLabel = p.partnerType ? PARTNER_TYPE_LABELS[p.partnerType] : 'Partner';
  const tagline = p.blurb || 'A special place to remember, celebrate and share the lives of those we love.';

  return (
    <main>
      <section className="hero">
        <div>
          <div className="eyebrow">{typeLabel}</div>
          <h1>{p.businessName}</h1>
          <p className="lead">{tagline}</p>
          <div className="actions">
            <ButtonLink href="/create" className="button">
              Create a Memorial
            </ButtonLink>
          </div>
          <p className="muted" style={{ marginTop: 18, fontSize: 14 }}>
            Every life tells a story. Keep their memories alive.
          </p>
        </div>
        <div className="partnerHeroArt">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.heroPhotoUrl}
            alt={p.heroPhotoIsCustom ? `${p.businessName}` : ''}
            className="partnerHeroPhoto"
            loading="eager"
          />
        </div>
      </section>

      <section className="section center">
        <div className="eyebrow">A lasting place to remember</div>
        <h2>Memories that last a lifetime.</h2>
        <p className="lead" style={{ margin: '0 auto', maxWidth: 680 }}>
          At {p.businessName} we believe every life has a story worth remembering. Bring together
          photographs, stories and heartfelt messages in one beautiful online memorial — a place
          family and friends can return to for years to come.
        </p>
        <div className="featureGrid">
          <div className="card">
            <div className="iconCircle">✎</div>
            <h3>Their life story</h3>
            <p className="muted">Celebrate the moments that made them who they were.</p>
          </div>
          <div className="card">
            <div className="iconCircle">♡</div>
            <h3>Messages &amp; memories</h3>
            <p className="muted">A place for family and friends to share their thoughts.</p>
          </div>
          <div className="card">
            <div className="iconCircle">▧</div>
            <h3>Photo collections</h3>
            <p className="muted">Preserve the photographs that mean the most.</p>
          </div>
          <div className="card">
            <div className="iconCircle">⌘</div>
            <h3>Easy to share</h3>
            <p className="muted">A personal link and QR code to revisit whenever you wish.</p>
          </div>
        </div>
      </section>

      {p.cemeteries.length > 0 && (
        <section className="section center">
          <div className="eyebrow">Where they rest</div>
          <h2>Cemeteries {p.businessName} works with.</h2>
          <p className="lead" style={{ margin: '0 auto 20px', maxWidth: 620 }}>
            Memorials and headstone records already on LiveOnWith.me for these graveyards.
          </p>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '0 auto',
              maxWidth: 520,
              display: 'grid',
              gap: 8,
            }}
          >
            {p.cemeteries.map((c) => (
              <li key={c.placeId}>
                <Link href={`/cemetery/${encodeURIComponent(c.placeId)}`}>{c.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section center">
        <div className="card" style={{ padding: '55px 25px' }}>
          <div className="eyebrow">Begin gently</div>
          <h2 style={{ marginTop: 6 }}>A memory worth keeping.</h2>
          <p className="lead" style={{ margin: '0 auto 24px', maxWidth: 620 }}>
            Create a memorial for someone you love — a peaceful place family and
            friends can return to for years to come.
          </p>
          <ButtonLink href="/create" className="button">
            Create Your Memorial
          </ButtonLink>
        </div>
      </section>

      {(p.website || (p.showPhone && p.phone) || (p.showEmail && p.email)) && (
        <section className="section center">
          <div className="eyebrow">Get in touch</div>
          <h2>{p.businessName}</h2>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '12px auto 0',
              display: 'flex',
              gap: 18,
              flexWrap: 'wrap',
              justifyContent: 'center',
              fontSize: 16,
            }}
          >
            {p.website && (
              <li>
                <a href={normaliseHref(p.website)} target="_blank" rel="noreferrer">
                  {prettyHost(p.website)}
                </a>
              </li>
            )}
            {p.showPhone && p.phone && (
              <li>
                <a href={`tel:${p.phone.replace(/\s+/g, '')}`}>{p.phone}</a>
              </li>
            )}
            {p.showEmail && p.email && (
              <li>
                <a href={`mailto:${p.email}`}>{p.email}</a>
              </li>
            )}
          </ul>
        </section>
      )}

      <section className="section center">
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          {p.businessName} · Remembering together
        </p>
      </section>

      <Suspense fallback={null}>
        <PartnerPublicPageEditor uid={p.uid} slug={p.slug} />
      </Suspense>
    </main>
  );
}

function normaliseHref(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function prettyHost(url: string): string {
  try {
    return new URL(normaliseHref(url)).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
