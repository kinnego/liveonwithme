// Server wrapper for the memorial page. Generates SEO metadata + JSON-LD
// structured data on the server so search engines and social previews get
// something meaningful without waiting for client-side hydration. The
// fetched memorial is also handed to the client component as initial
// state, so the public view paints without a second Firestore round-trip.

import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import type { Metadata } from 'next';
import { adminDb } from '@/lib/firebase-admin';
import MemorialView, { type SiblingMemorial } from './MemorialView';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.liveonwith.me';

// Cache the rendered HTML for a minute. Public memorial pages are read-heavy
// and rarely change: visitors scanning a QR code or opening a shared link get
// a CDN hit, not a Firestore round-trip + cold function boot. Handlers that
// change what's visible (go-live, hero change, orphan delete, account delete)
// call `revalidatePath('/m/{id}')` to bust early. Within the 60s window a
// stale page may show briefly, which is acceptable for freshness-insensitive
// content and bounded below the TTL regardless.
export const revalidate = 60;

// Raw Firestore reader — wrapped below in unstable_cache so visitors share
// one Firestore round-trip per slug per revalidation window. Mutating
// handlers call `revalidateTag('memorial:<id>')` to bust early.
async function fetchMemorial(slug: string) {
  if (slug === 'mary-demo') {
    return {
      fullName: "Mary O'Donnell",
      epitaph: 'She made everyone feel like they belonged.',
      born: '1948-03-12',
      died: '2025-11-04',
      heroPhotoUrl: '/demo/liveonwithme_lifestyle_01.jpg',
      visibility: 'public',
      status: 'live',
    } as Record<string, any>;
  }
  try {
    const snap = await adminDb().collection('memorials').doc(slug).get();
    if (!snap.exists) return null;
    const data = snap.data() as any;
    if (data.status !== 'live') return null;
    if (data.offline === true) return null;
    // Legacy 'private' records (from the retired "Family only" option) are
    // aliased to unlisted here: link-accessible, noindex. See lib/types.ts.
    if (!['public', 'unlisted', 'private'].includes(data.visibility)) return null;
    // JSON round-trip strips Firestore Timestamps so the plain object can
    // cross the server/client boundary as a prop.
    return { id: snap.id, ...JSON.parse(JSON.stringify(data)) };
  } catch {
    return null;
  }
}

async function fetchSiblings(
  plotId: string,
  excludeMemorialId: string,
): Promise<SiblingMemorial[]> {
  try {
    const mems = await adminDb()
      .collection('plotMemberships')
      .where('plotId', '==', plotId)
      .where('status', '==', 'approved')
      .get();

    const memorialIds = mems.docs
      .map((d) => d.data().memorialId as string | undefined)
      .filter((id): id is string => !!id && id !== excludeMemorialId);
    if (memorialIds.length === 0) return [];

    const results: SiblingMemorial[] = [];
    for (const id of memorialIds) {
      const m = await adminDb().collection('memorials').doc(id).get();
      if (!m.exists) continue;
      const data = m.data() as any;
      if (data.status !== 'live') continue;
      if (data.offline === true) continue;
      if (!['public', 'unlisted'].includes(data.visibility)) continue;
      results.push({
        id: m.id,
        slug: data.slug || m.id,
        fullName: data.fullName || '',
      });
    }
    return results;
  } catch {
    return [];
  }
}

// `unstable_cache` persists across requests (Netlify's Next.js runtime keeps
// it in the shared cache). `cache()` on top dedupes within a single request so
// generateMetadata() and Page() share one call. Tags are per-slug so busting
// one memorial doesn't invalidate the others.
const loadMemorial = cache((slug: string) =>
  unstable_cache(() => fetchMemorial(slug), ['memorial', slug], {
    revalidate: 60,
    tags: [`memorial:${slug}`],
  })(),
);

const loadSiblings = cache((plotId: string, excludeMemorialId: string) =>
  unstable_cache(
    () => fetchSiblings(plotId, excludeMemorialId),
    ['siblings', plotId, excludeMemorialId],
    {
      revalidate: 60,
      tags: [`plot:${plotId}`, `memorial:${excludeMemorialId}`],
    },
  )(),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const m = await loadMemorial(slug);

  if (!m) {
    return {
      title: 'Memorial · LiveOnWith.me',
      description: 'A peaceful place to remember someone.',
      robots: { index: false, follow: false },
    };
  }

  const born = m.born?.slice(0, 4);
  const died = m.died?.slice(0, 4);
  const isLegacy = m.kind === 'legacy';
  const years = isLegacy
    ? born || ''
    : born && died
      ? `${born} — ${died}`
      : born || died || '';
  const title = `${m.fullName}${years ? ` (${years})` : ''} · LiveOnWith.me`;
  const description =
    m.epitaph ||
    (isLegacy
      ? `A page written by ${m.fullName}.`
      : `A page in memory of ${m.fullName}.`);
  const image =
    m.heroPhotoUrl ||
    (m.heroPhotoPath && R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${m.heroPhotoPath}` : undefined);

  const noindex = m.visibility !== 'public';

  return {
    title,
    description,
    robots: noindex ? { index: false, follow: false } : undefined,
    openGraph: {
      title,
      description,
      type: isLegacy ? 'website' : 'profile',
      url: `${SITE_URL}/m/${slug}`,
      images: image ? [image] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: image ? [image] : undefined,
    },
    alternates: { canonical: `${SITE_URL}/m/${slug}` },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const m = await loadMemorial(slug);

  const siblings =
    m && m.plotId && m.id ? await loadSiblings(m.plotId, m.id) : [];

  const heroUrl =
    m?.heroPhotoUrl ||
    (m?.heroPhotoPath && R2_PUBLIC_URL
      ? m.heroPhotoVariants
        ? `${R2_PUBLIC_URL}/${m.heroPhotoPath}.800.webp`
        : `${R2_PUBLIC_URL}/${m.heroPhotoPath}`
      : undefined);

  const jsonLd = m
    ? {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: m.fullName,
        description: m.epitaph || undefined,
        birthDate: m.born || undefined,
        deathDate: m.died || undefined,
        url: `${SITE_URL}/m/${slug}`,
        image: heroUrl,
      }
    : null;

  return (
    <>
      {heroUrl && (
        // React 19 hoists this <link> into <head>; the browser fetches the
        // hero at high priority instead of waiting for the CSS background
        // to be discovered.
        <link rel="preload" as="image" href={heroUrl} fetchPriority="high" />
      )}
      {jsonLd && (
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <MemorialView params={params} initialMemorial={m} initialSiblings={siblings} mode="public" />
    </>
  );
}
