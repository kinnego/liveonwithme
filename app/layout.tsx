import './globals.css';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://liveonwith.me'),
  title: 'LiveOnWith.me — A life remembered with love',
  description:
    'A peaceful place to remember someone you love, share their story and gather treasured memories.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/brand/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/brand/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/favicon-48x48.png', sizes: '48x48', type: 'image/png' },
      { url: '/brand/favicon-64x64.png', sizes: '64x64', type: 'image/png' },
      { url: '/brand/favicon-128x128.png', sizes: '128x128', type: 'image/png' },
      { url: '/brand/favicon.ico' },
    ],
    apple: '/brand/apple-touch-icon.png',
  },
  openGraph: {
    title: 'LiveOnWith.me — A life remembered with love',
    description:
      'A peaceful place to remember someone you love, share their story and gather treasured memories.',
    images: ['/brand/live-on-with-me-logo-512.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LiveOnWith.me — A life remembered with love',
    description:
      'A peaceful place to remember someone you love, share their story and gather treasured memories.',
    images: ['/brand/live-on-with-me-logo-512.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <header className="siteHeader">
          <Link className="brand" href="/">
            <Image
              src="/brand/live-on-with-me-logo-192.png"
              alt="LiveOnWith.me"
              width={40}
              height={40}
              priority
              className="brandLogo"
            />
            <span className="brandName">LiveOnWith.me</span>
          </Link>
          <nav>
            <Link href="/auth">Sign in</Link>
            <Link className="button small" href="/create">
              Create a memorial
            </Link>
          </nav>
        </header>
        {children}
        <footer>
          Made for remembering, gently and privately. ·{' '}
          <Link href="/fd" className="muted">
            For funeral directors
          </Link>
        </footer>
      </body>
    </html>
  );
}
