// Netlify scheduled function — runs daily and hits the Next.js API route
// that does the actual sweep. Keeping the heavy lifting inside the Next.js
// runtime avoids duplicating firebase-admin + R2 bootstrap here and lets
// us test the endpoint locally with any HTTP client.
//
// Netlify picks up `config.schedule` at build time; the function must be
// deployed by Netlify (not just committed) before the cron starts firing.

export default async () => {
  const site = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const secret = process.env.CRON_SECRET;
  if (!site || !secret) {
    console.error('orphan-sweep: missing URL or CRON_SECRET env');
    return;
  }
  try {
    const res = await fetch(`${site}/api/cron/orphan-sweep`, {
      method: 'POST',
      headers: { 'x-cron-secret': secret },
    });
    const body = await res.text();
    console.log('orphan-sweep response', res.status, body.slice(0, 500));
  } catch (err) {
    console.error('orphan-sweep: fetch failed', err);
  }
};

export const config = {
  // Daily at 03:15 UTC — well outside the Ireland + UK morning peak.
  schedule: '15 3 * * *',
};
