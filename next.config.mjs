/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  // firebase-admin loads gRPC + native bindings that must not be bundled by
  // the server-components bundler. It is on Next.js's default auto-external
  // list, but some deploy targets (Netlify's Next.js runtime) need it stated
  // explicitly. Left here defensively.
  serverExternalPackages: ['firebase-admin'],
};
export default nextConfig;
