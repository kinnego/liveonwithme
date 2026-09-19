import Link from 'next/link';
import Image from 'next/image';
import CemeterySearch from '@/components/CemeterySearch';

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div>
          <div className="eyebrow">A place for their story</div>
          <h1>
            Love doesn&rsquo;t end.
            <br />
            Their story lives on.
          </h1>
          <p className="lead">
            A peaceful place for the stories that shouldn&rsquo;t be lost — a memorial for
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
            Family-controlled · Contributions approved before publishing · No public like counts
          </p>
        </div>
        <div className="heroMark">
          <Image
            src="/brand/live-on-with-me-logo-1024.png"
            alt="Live on With Me — memories live forever"
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
          Search by the cemetery where they are resting.
        </p>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <CemeterySearch />
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
              Collect stories you may never have heard — from school friends, neighbours,
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
    </main>
  );
}
