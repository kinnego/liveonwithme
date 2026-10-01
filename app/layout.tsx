import './globals.css';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata, Viewport } from 'next';
import SiteNav from '@/components/SiteNav';
import ScrollToTopOnNav from '@/components/ScrollToTopOnNav';
import PrivacyBanner from '@/components/PrivacyBanner';

const DEFAULT_TITLE = 'LiveOnWith.me · A life remembered with love';
const DEFAULT_DESCRIPTION =
  'A peaceful digital memorial to remember someone you love. Share their story, gather photos and memories, and find cemetery locations — private, family-controlled, forever.';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#faf7f0',
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://www.liveonwith.me'),
  title: {
    default: DEFAULT_TITLE,
    template: '%s · LiveOnWith.me',
  },
  description: DEFAULT_DESCRIPTION,
  keywords: [
    'digital memorial',
    'online memorial',
    'memorial page',
    'obituary',
    'remember a loved one',
    'cemetery',
    'grave marker',
    'QR code headstone',
    'funeral',
    'condolences',
    'in memoriam',
    'legacy page',
  ],
  applicationName: 'LiveOnWith.me',
  authors: [{ name: 'Freastar' }],
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
  alternates: { canonical: '/' },
  openGraph: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: '/',
    siteName: 'LiveOnWith.me',
    images: ['/brand/live-on-with-me-logo-512.png'],
    type: 'website',
    locale: 'en_IE',
  },
  twitter: {
    card: 'summary_large_image',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: ['/brand/live-on-with-me-logo-512.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body suppressHydrationWarning>
        <ScrollToTopOnNav />
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
          <SiteNav />
        </header>
        {children}
        <footer>
          <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 24px' }}>
            <div
              style={{
                display: 'flex',
                gap: 20,
                justifyContent: 'center',
                flexWrap: 'wrap',
                marginBottom: 10,
                fontSize: 13,
              }}
            >
              <Link href="/partner/apply" style={{ color: 'var(--muted)' }}>
                For funeral directors &amp; partners
              </Link>
              <Link href="/help/succession" style={{ color: 'var(--muted)' }}>
                Need help managing a memorial?
              </Link>
              <Link href="/terms" style={{ color: 'var(--muted)' }}>
                Fair-use terms
              </Link>
              <Link href="/privacy" style={{ color: 'var(--muted)' }}>
                Privacy
              </Link>
              <a href="mailto:hello@freastar.com" style={{ color: 'var(--muted)' }}>
                hello@freastar.com
              </a>
            </div>
            <div>
              Made for remembering, gently and privately. · Powered by{' '}
              <a
                href="https://www.freastar.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 }}
              >
                Freastar
              </a>
            </div>
          </div>
        </footer>
        <PrivacyBanner />
      </body>
    </html>
  );
}
