// Plot page — public listing of every memorial associated with a physical
// grave. This is where a QR scan lands (via /p/[shortId]). Kept SSR so it's
// fast and share-friendly.

import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { adminDb } from '@/lib/firebase-admin';
import { walkingDirectionsUrl } from '@/lib/plot';
import type { Memorial, Plot } from '@/lib/types';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://liveonwith.me';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ plotId: string }>;
}): Promise<Metadata> {
  const { plotId } = await params;
  const plot = await loadPlot(plotId);
  if (!plot) {
    return { title: 'Plot · LiveOnWith.me' };
  }
  const title = `${plot.name || plot.cemetery.name} · LiveOnWith.me`;
  const description = `A resting place at ${plot.cemetery.name}. Everyone remembered here, in one gentle page.`;
  return {
    title,
    description,
    openGraph: { title, description, url: `${SITE_URL}/plot/${plotId}`, type: 'website' },
    twitter: { card: 'summary', title, description },
    alternates: { canonical: `${SITE_URL}/plot/${plotId}` },
  };
}

async function loadPlot(plotId: string): Promise<Plot | null> {
  const snap = await adminDb().collection('plots').doc(plotId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<Plot, 'id'>) };
}

async function loadPlotMemorials(plotId: string): Promise<Memorial[]> {
  const mems = await adminDb()
    .collection('plotMemberships')
    .where('plotId', '==', plotId)
    .where('status', '==', 'approved')
    .get();

  const memorialIds = mems.docs.map((d) => d.data().memorialId as string).filter(Boolean);
  if (memorialIds.length === 0) return [];

  const results: Memorial[] = [];
  for (const id of memorialIds) {
    const m = await adminDb().collection('memorials').doc(id).get();
    if (!m.exists) continue;
    const data = m.data() as any;
    if (data.status !== 'live') continue;
    if (!['public', 'unlisted'].includes(data.visibility)) continue;
    results.push({ id: m.id, ...(data as Omit<Memorial, 'id'>) });
  }
  return results;
}

export default async function PlotPage({
  params,
}: {
  params: Promise<{ plotId: string }>;
}) {
  const { plotId } = await params;
  const plot = await loadPlot(plotId);
  if (!plot) return notFound();

  const memorials = await loadPlotMemorials(plotId);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: plot.name || plot.cemetery.name,
    address: plot.cemetery.address || undefined,
    geo:
      plot.cemetery.lat != null && plot.cemetery.lng != null
        ? {
            '@type': 'GeoCoordinates',
            latitude: plot.cemetery.lat,
            longitude: plot.cemetery.lng,
          }
        : undefined,
    url: `${SITE_URL}/plot/${plotId}`,
  };

  return (
    <main className="shell">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">A resting place, remembered</div>
          <h2 style={{ marginBottom: 6 }}>
            {plot.name || plot.cemetery.name}
          </h2>
          {plot.cemetery.name && (
            <p className="muted" style={{ margin: 0 }}>
              {plot.cemetery.name}
              {plot.cemetery.address && (
                <span> · {plot.cemetery.address}</span>
              )}
            </p>
          )}
        </div>
      </div>

      {typeof plot.lat === 'number' && typeof plot.lng === 'number' && (
        <div
          className="card"
          style={{ marginBottom: 16, background: '#f7f4ee', borderColor: '#e0d8c8' }}
        >
          <a
            href={walkingDirectionsUrl({ lat: plot.lat, lng: plot.lng })}
            target="_blank"
            rel="noopener noreferrer"
            className="button"
            style={{ textDecoration: 'none' }}
          >
            Walking directions to the grave →
          </a>
          <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>
            Opens in your maps app. Follow it to the headstone.
          </p>
        </div>
      )}

      {plot.cemetery.placeId && (
        <div className="card" style={{ marginBottom: 24 }}>
          <p className="muted" style={{ margin: 0 }}>
            <Link
              href={`/cemetery/${encodeURIComponent(plot.cemetery.placeId)}?name=${encodeURIComponent(plot.cemetery.name)}`}
            >
              See directions and other memorials at this cemetery →
            </Link>
          </p>
        </div>
      )}

      {memorials.length === 0 ? (
        <div className="formCard center">
          <div className="eyebrow">Quiet for now</div>
          <h3>No memorials have been added to this plot yet.</h3>
          <p className="muted">
            When a family adds a memorial to this plot, it will appear here for anyone who
            scans the plot&rsquo;s QR code or visits this page.
          </p>
        </div>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: 20 }}>
            {memorials.length === 1
              ? 'One person is remembered here.'
              : `${memorials.length} people are remembered here.`}
          </p>
          <div className="featureGrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {memorials.map((m) => {
              const born = m.born?.slice(0, 4) || '';
              const died = m.died?.slice(0, 4) || '';
              return (
                <Link
                  key={m.id}
                  href={`/m/${m.slug}`}
                  className="card"
                  style={{ display: 'block', textDecoration: 'none' }}
                >
                  <h3 style={{ marginBottom: 4 }}>{m.fullName}</h3>
                  {(born || died) && (
                    <p className="muted" style={{ margin: '0 0 10px' }}>
                      {born}{born && died ? ' — ' : ''}{died}
                    </p>
                  )}
                  {m.epitaph && (
                    <p style={{ fontFamily: 'Georgia,serif', fontStyle: 'italic' }}>
                      &ldquo;{m.epitaph}&rdquo;
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
