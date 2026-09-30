import type { MetadataRoute } from 'next';
import { adminDb } from '@/lib/firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.liveonwith.me';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${SITE_URL}/partner/apply`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/help/succession`, lastModified: now, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  const [memorialsSnap, membershipsSnap] = await Promise.all([
    adminDb()
      .collection('memorials')
      .where('status', '==', 'live')
      .where('visibility', '==', 'public')
      .get(),
    adminDb()
      .collection('plotMemberships')
      .where('status', '==', 'approved')
      .get(),
  ]);

  const memorialEntries: MetadataRoute.Sitemap = memorialsSnap.docs.map(
    (d: QueryDocumentSnapshot) => {
      const data = d.data();
      const updated = data.updatedAt?.toDate?.() || data.publishedAt?.toDate?.() || now;
      return {
        url: `${SITE_URL}/m/${data.slug || d.id}`,
        lastModified: updated,
        changeFrequency: 'weekly' as const,
        priority: 0.9,
      };
    }
  );

  const plotIds = new Set<string>();
  membershipsSnap.forEach((d: QueryDocumentSnapshot) => {
    const pid = d.data().plotId;
    if (pid && typeof pid === 'string') plotIds.add(pid);
  });
  const plotEntries: MetadataRoute.Sitemap = Array.from(plotIds).map((plotId) => ({
    url: `${SITE_URL}/plot/${plotId}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  return [...staticEntries, ...memorialEntries, ...plotEntries];
}
