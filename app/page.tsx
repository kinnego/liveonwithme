import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import CemeterySearch from '@/components/CemeterySearch';
import MemorialNameSearch from '@/components/MemorialNameSearch';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.liveonwith.me';

export const metadata: Metadata = {
  title: 'Digital memorials that honour a life — LiveOnWith.me',
  description:
    'Create a beautiful online memorial for someone you love. Share their story, gather memories from family and friends, and link it to their grave with a discreet QR code. Family-controlled, private, and hosted for a lifetime.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Digital memorials that honour a life — LiveOnWith.me',
    description:
      'Create a beautiful online memorial for someone you love. Share their story, gather memories, and connect it to their resting place.',
    url: '/',
    type: 'website',
  },
};

export default function Home() {
  const websiteLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'LiveOnWith.me',
    url: SITE_URL,
    inLanguage: 'en',
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
  const organizationLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'LiveOnWith.me',
    legalName: 'Freastar Ltd',
    url: SITE_URL,
    logo: `${SITE_URL}/brand/live-on-with-me-logo-512.png`,
    email: 'hello@freastar.com',
    sameAs: [],
  };
  return (
    <main>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteLd) }}
      />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
      />
      <section className="hero">
        <div>
          <div className="eyebrow">A place for their story</div>
          <h1>Love doesn&rsquo;t end. Their story lives on.</h1>
          <p className="lead">
            A peaceful place for the stories that shouldn&rsquo;t be lost. A memorial for
            someone you love, or a page in your own words for the people who will come after.
          </p>
          <div className="actions">
            <Link href="/create" className="button">
              Create a page
            </Link>
            <Link href="/m/mary-demo" className="button secondary">
              See an example
            </Link>
          </div>
          <p className="muted" style={{ marginTop: 18, fontSize: 14 }}>
            <span style={{ whiteSpace: 'nowrap' }}>Family-controlled</span>
            {' · '}
            <span style={{ whiteSpace: 'nowrap' }}>Contributions approved before publishing</span>
            {' · '}
            <span style={{ whiteSpace: 'nowrap' }}>No public like counts</span>
          </p>
        </div>
        <div className="heroMark">
          <Image
            src="/brand/live-on-with-me-logo-1024.png"
            alt="Live on With Me. Memories live forever."
            width={520}
            height={520}
            priority
            className="heroLogo"
          />
          <div className="floatingNote">
            <strong>A new memory arrived</strong>
            <div className="muted">From Anna · awaiting family approval</div>
          </div>
        </div>
      </section>

      <section className="section center" id="find">
        <div className="eyebrow">Find someone</div>
        <h2>Looking for a loved one&rsquo;s memorial?</h2>
        <p className="lead" style={{ margin: '0 auto 30px' }}>
          Search by their name, or by the cemetery where they are resting.
        </p>
        <div style={{ maxWidth: 520, margin: '0 auto', display: 'grid', gap: 14 }}>
          <div>
            <label
              className="muted"
              style={{ fontSize: 13, display: 'block', marginBottom: 6, textAlign: 'left' }}
            >
              By name
            </label>
            <MemorialNameSearch />
          </div>
          <div>
            <label
              className="muted"
              style={{ fontSize: 13, display: 'block', marginBottom: 6, textAlign: 'left' }}
            >
              By cemetery
            </label>
            <CemeterySearch />
          </div>
        </div>
        <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>
          Only memorials families have chosen to make public will appear.
        </p>
      </section>

      <section className="section center">
        <div className="eyebrow">Remember the whole person</div>
        <h2>More than a memorial page.</h2>
        <p className="lead" style={{ margin: 'auto' }}>
          A living collection of the moments, voices and photographs that a family never wants
          to lose.
        </p>
        <div className="featureGrid">
          <div className="card">
            <div className="iconCircle">♡</div>
            <h3>Their story</h3>
            <p className="muted">
              Tell their life in your own words, from the big milestones to the tiny things
              everyone loved.
            </p>
          </div>
          <div className="card">
            <div className="iconCircle">▧</div>
            <h3>Shared photographs</h3>
            <p className="muted">
              Friends can send photographs directly to the family. Nothing appears publicly
              until you approve it.
            </p>
          </div>
          <div className="card">
            <div className="iconCircle">✦</div>
            <h3>Memories from everyone</h3>
            <p className="muted">
              Collect stories you may never have heard. From school friends, neighbours,
              colleagues and family.
            </p>
          </div>
        </div>
      </section>

      <section className="section center">
        <div className="card" style={{ padding: '55px 25px' }}>
          <div className="eyebrow">Keep them close</div>
          <div className="quote">
            &ldquo;A person&rsquo;s life is not only the years they lived, but the stories that
            remain in everyone they touched.&rdquo;
          </div>
          <Link href="/create" className="button">
            Begin gently
          </Link>
        </div>
      </section>

      <section className="section center">
        <div
          className="card"
          style={{
            padding: '45px 28px',
            background: '#faf7f0',
            borderColor: '#e6dfc9',
          }}
        >
          <div className="eyebrow">For funeral directors</div>
          <h2 style={{ marginTop: 6, marginBottom: 14 }}>
            Offer families a beautiful place for their loved one&rsquo;s memories
          </h2>
          <p className="lead" style={{ margin: '0 auto 26px', maxWidth: 620 }}>
            Partner with us and give the families you serve a peaceful digital
            keepsake, set up in minutes and cared for by them for a lifetime.
            You focus on the family; we handle the technology.
          </p>
          <Link href="/partner/apply" className="button">
            Become a partner
          </Link>
        </div>
      </section>
    </main>
  );
}
