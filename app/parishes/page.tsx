// "LiveOnWith.me for parishes": the page we send a parish priest, sacristan
// or graveyard committee to. Written for people who don't use computers
// much: short sentences, no jargon, one thing per step, and a human to email.

import type { Metadata } from 'next';
import CemeterySearch from '@/components/CemeterySearch';
import ButtonLink from '@/components/ButtonLink';
import { SUPER_ADMIN_EMAIL } from '@/lib/types';

export const metadata: Metadata = {
  title: 'For parishes and graveyards · LiveOnWith.me',
  description:
    'Put your parish burial register online, free. Families looking for a loved one’s grave find it, and the location, in a few taps.',
};

const steps: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Find your graveyard',
    body: (
      <>
        Type its name in the box at the bottom of this page and pick it from the list. Then sign
        in with your email address. That&rsquo;s your account made.
      </>
    ),
  },
  {
    title: 'Tell us what your register looks like',
    body: (
      <>
        Is it a handwritten book, a typed list, or a spreadsheet? Does it have dates, ages,
        townlands? Tick what it has. We use your answers to give you simple instructions.
      </>
    ),
  },
  {
    title: 'Get the names in',
    body: (
      <>
        Choose whatever is easiest for you:
        <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          <li>
            <strong>Take photos of the pages</strong> and give them to a free AI helper like
            ChatGPT, with the words we give you to copy and paste. It turns your photos into a
            list you can upload.
          </li>
          <li>
            <strong>Type them in</strong> one grave at a time, on your phone or computer.
          </li>
          <li>
            <strong>Email us</strong> and we&rsquo;ll help you do it.
          </li>
        </ul>
        <p style={{ margin: '8px 0 0' }}>You always see a preview first. Nothing is saved until you say so.</p>
      </>
    ),
  },
  {
    title: 'Walk the graveyard (if you like)',
    body: (
      <>
        Bring your phone. Stand at a grave, find the name on your list and tap{' '}
        <strong>&ldquo;Pin here&rdquo;</strong>. Now families can be guided right to it. You can do
        a few rows at a time, or skip this step altogether.
      </>
    ),
  },
];

const faqs: { q: string; a: React.ReactNode }[] = [
  {
    q: 'Does it cost anything?',
    a: <>No. It&rsquo;s free for parishes and graveyards.</>,
  },
  {
    q: 'Can anyone look through our register?',
    a: (
      <>
        No. The register is not published and can&rsquo;t be searched by the public. A family only
        sees a grave when it matches the name of the person they are making a memorial for.
      </>
    ),
  },
  {
    q: 'What if a family picks the wrong grave?',
    a: (
      <>
        Nothing is ever linked automatically. The family has to say &ldquo;Yes, this is the
        grave&rdquo; themselves. If they see a mistake in a record, they can tell you with one
        tap, and you can fix it.
      </>
    ),
  },
  {
    q: 'Our records are old, patchy, or partly in Irish. Is that a problem?',
    a: (
      <>
        Not at all. Only a surname is needed for each person. Leave out anything you don&rsquo;t
        have. We understand Ó and O&rsquo;, Mac and Mc, and Pádraig and Patrick, so families still
        find the right grave. If a word is hard to read, mark it with ?? and carry on.
      </>
    ),
  },
  {
    q: 'Can other people help us?',
    a: (
      <>
        Yes. Once you&rsquo;re set up, you can add helpers by typing in their email address. A
        few people can share the work of walking the graveyard.
      </>
    ),
  },
  {
    q: 'I’m not good with computers.',
    a: (
      <>
        That&rsquo;s alright. Email us at{' '}
        <a href={`mailto:${SUPER_ADMIN_EMAIL}`} style={{ textDecoration: 'underline' }}>
          {SUPER_ADMIN_EMAIL}
        </a>{' '}
        and a real person will help you get started. Many parishes ask a younger relative or a
        neighbour to help with the first upload.
      </>
    ),
  },
  {
    q: 'Is it safe to put photos of the book into ChatGPT?',
    a: (
      <>
        Burial registers are usually about people who died many years ago. But if your book has
        recent burials or anything private, leave those pages out, or type them in by hand
        instead.
      </>
    ),
  },
  {
    q: 'Do we keep our own copy?',
    a: (
      <>
        Yes. Every list you upload is kept, and you can download it again whenever you like. Your
        book stays exactly where it is.
      </>
    ),
  },
  {
    q: 'What if I want to stop?',
    a: (
      <>
        You can step down at any time. The records stay, so the next person can carry on.
      </>
    ),
  },
];

export default function ParishesPage() {
  return (
    <main style={{ fontSize: 18 }}>
      <section className="section" style={{ maxWidth: 820 }}>
        <div className="eyebrow">For parishes and graveyards</div>
        <h1 style={{ fontSize: 'clamp(40px, 6vw, 68px)' }}>Help families find their loved one&rsquo;s grave</h1>
        <p className="lead" style={{ fontSize: 21 }}>
          Put your parish burial register online, free. When a family makes a memorial page on
          LiveOnWith.me, we check your register and show them the grave, with its row, plot number
          and location.
        </p>
        <div className="actions">
          <ButtonLink href="#start" className="button">
            Get started
          </ButtonLink>
          <ButtonLink href="/parishes/flyer" className="button secondary">
            Print a leaflet
          </ButtonLink>
        </div>
      </section>

      <section className="section" style={{ maxWidth: 820 }}>
        <h2>Who is this for?</h2>
        <p>
          Anyone who looks after a graveyard&rsquo;s burial records: a parish priest, a parish
          secretary, a sacristan, a graveyard committee, or a local history group. If people ring
          you asking &ldquo;where is my granny buried?&rdquo;, this is for you.
        </p>
        <p>
          It saves you those phone calls, and it keeps your register safe if the book is ever
          lost or damaged.
        </p>
      </section>

      <section className="section" style={{ maxWidth: 820 }}>
        <h2>How it works</h2>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 16 }}>
          {steps.map((s, i) => (
            <li key={s.title} className="card" style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
              <div
                aria-hidden
                style={{
                  flex: '0 0 44px',
                  height: 44,
                  borderRadius: '50%',
                  background: 'var(--sage2)',
                  display: 'grid',
                  placeItems: 'center',
                  fontFamily: 'Georgia, serif',
                  fontSize: 22,
                }}
              >
                {i + 1}
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontSize: 24, margin: '6px 0 8px' }}>{s.title}</h3>
                <div>{s.body}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="section" style={{ maxWidth: 820 }}>
        <h2>What families see</h2>
        <p>
          When someone makes a memorial page and chooses your graveyard, they see something like
          this:
        </p>
        <div className="card" style={{ maxWidth: 520, margin: '20px auto', borderWidth: 2 }}>
          <div className="eyebrow">From the St Mary&rsquo;s burial register</div>
          <h3 style={{ fontSize: 22, margin: '8px 0 12px' }}>Could this be the grave you&rsquo;re looking for?</h3>
          <div style={{ fontWeight: 700, fontSize: 19 }}>Bridget O&rsquo;Donnell</div>
          <div className="muted" style={{ fontSize: 15 }}>Known as Biddy, died 14 March 1987, aged 82, Meenacross</div>
          <div className="muted" style={{ fontSize: 15, marginTop: 6 }}>Section B, Row 4, Plot 12 · 📍 pinned on the map</div>
          <p style={{ fontSize: 15, margin: '8px 0 0' }}>Also resting here: Hugh O&rsquo;Donnell (1979)</p>
          <div style={{ marginTop: 14 }}>
            <span className="button" aria-hidden style={{ cursor: 'default' }}>
              Yes, this is the grave
            </span>
          </div>
        </div>
        <p className="muted" style={{ textAlign: 'center', fontSize: 15 }}>
          An example only. If they tap yes, the grave and its location are added to their memorial
          page. If not, nothing happens.
        </p>
      </section>

      <section className="section" style={{ maxWidth: 820 }}>
        <h2>Your questions</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {faqs.map((f) => (
            <details key={f.q} className="card" style={{ padding: '18px 22px' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{f.q}</summary>
              <div style={{ marginTop: 10 }}>{f.a}</div>
            </details>
          ))}
        </div>
      </section>

      <section className="section center" id="start" style={{ maxWidth: 820, scrollMarginTop: 20 }}>
        <h2>Find your graveyard</h2>
        <p className="lead" style={{ margin: '0 auto 24px' }}>
          Type the name of the graveyard or church, then pick it from the list.
        </p>
        <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'left' }}>
          <CemeterySearch target="registrar" />
        </div>
        <p className="muted" style={{ marginTop: 22, fontSize: 16 }}>
          Stuck? Email{' '}
          <a href={`mailto:${SUPER_ADMIN_EMAIL}`} style={{ textDecoration: 'underline' }}>
            {SUPER_ADMIN_EMAIL}
          </a>{' '}
          and we&rsquo;ll help.
        </p>
      </section>
    </main>
  );
}
