/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  // firebase-admin loads gRPC + native bindings that must not be bundled by
  // the server-components bundler. It is on Next.js's default auto-external
  // list, but some deploy targets (Netlify's Next.js runtime) need it stated
  // explicitly. @google-cloud/firestore is loaded dynamically by firebase-admin
  // and must be external too, otherwise Netlify's page-data collector fails
  // with "Cannot find module '@google-cloud/firestore'".
  serverExternalPackages: ['firebase-admin', '@google-cloud/firestore'],
};
export default nextConfig;
