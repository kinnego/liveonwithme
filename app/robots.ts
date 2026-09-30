import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.liveonwith.me';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/partner/apply'],
        disallow: [
          '/api/',
          '/admin/',
          '/auth',
          '/auth/',
          '/dashboard',
          '/claim/',
          '/custody/',
          '/memorial/',
          '/partner',
          '/partner/new',
          '/cemetery/add',
          '/p/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
