/** @type {import('next').NextConfig} */

// Content-Security-Policy. 'unsafe-inline' + 'unsafe-eval' on script-src are
// pragmatic concessions:
//   - Next.js hydration + the Google Maps JS SDK rely on inline + eval.
//   - Tightening to nonces would require moving every <script> through a
//     Next.js nonce-aware helper, which is more surgery than this MVP needs.
// Everything else is scoped to origins we actually use. img/media use broad
// https: because families upload photos and audio from a wide variety of
// sources via R2 and the public URL may be rotated.
// Firebase Auth signInWithPopup loads apis.google.com/js/api.js into the
// parent page (not the iframe) and opens an OAuth popup at accounts.google.com.
// gstatic hosts the Firebase SDK chunks loaded on demand. The auth handler
// itself runs in an iframe at <project>.firebaseapp.com.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com https://apis.google.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com",
  "frame-src 'self' https://js.stripe.com https://checkout.stripe.com https://*.firebaseapp.com https://accounts.google.com",
  "form-action 'self' https://checkout.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  // One year HSTS with subdomain + preload: once Netlify is serving over
  // HTTPS on the apex, browsers refuse to speak HTTP to us.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  // Blocks MIME sniffing — e.g. a .txt served as text/plain can't be
  // reinterpreted as script.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Clickjacking: frame-ancestors in CSP is the modern form, X-Frame-Options
  // is the legacy fallback for older browsers.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Trim what we leak via the Referer header on cross-origin navigation.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Camera/microphone are not used anywhere in the app; geolocation is used
  // only on this origin (cemetery nearby/add); interest-cohort opts out of
  // FLoC/Topics.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self), interest-cohort=()',
  },
  { key: 'Content-Security-Policy', value: csp },
];

const nextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  // firebase-admin loads gRPC + native bindings that must not be bundled by
  // the server-components bundler. It is on Next.js's default auto-external
  // list, but some deploy targets (Netlify's Next.js runtime) need it stated
  // explicitly. @google-cloud/firestore is loaded dynamically by firebase-admin
  // and must be external too, otherwise Netlify's page-data collector fails
  // with "Cannot find module '@google-cloud/firestore'".
  serverExternalPackages: ['firebase-admin', '@google-cloud/firestore'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};
export default nextConfig;
