// Server wrapper for the memorial page. Generates SEO metadata + JSON-LD
// structured data on the server so search engines and social previews get
// something meaningful without waiting for client-side hydration.

import type { Metadata } from 'next';
import { adminDb } from '@/lib/firebase-admin';
import MemorialView from './MemorialView';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://liveonwith.me';

async function loadMemorial(slug: string) {
  if (slug === 'mary-demo') {
    return {
      fullName: "Mary O'Donnell",
      epitaph: 'She made everyone feel like they belonged.',
      born: '1948-03-12',
      died: '2025-11-04',
      heroPhotoUrl: '/demo/liveonwithme_lifestyle_01.jpg',
      visibility: 'public',
      status: 'live',
    };
  }
  try {
    const snap = await adminDb().collection('memorials').doc(slug).get();
    if (!snap.exists) return null;
    const data = snap.data() as any;
    if (data.status !== 'live') return null;
    if (!['public', 'unlisted'].includes(data.visibility)) return null;
    return data;
  } catch {
    return null;
  }
}

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

  const jsonLd = m
    ? {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: m.fullName,
        description: m.epitaph || undefined,
        birthDate: m.born || undefined,
        deathDate: m.died || undefined,
        url: `${SITE_URL}/m/${slug}`,
        image: m.heroPhotoUrl || (m.heroPhotoPath ? `${R2_PUBLIC_URL}/${m.heroPhotoPath}` : undefined),
      }
    : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <MemorialView params={params} />
    </>
  );
}
