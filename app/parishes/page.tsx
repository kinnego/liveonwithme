// "LiveOnWith.me for parishes": the page we send a parish priest, sacristan
// or graveyard committee to. Written for people who don't use computers
// much: short sentences, no jargon, one thing per step, and a human to email.

import type { Metadata } from 'next';
import CemeterySearch from '@/components/CemeterySearch';
import ButtonLink from '@/components/ButtonLink';
import MyGraveyards from '@/components/MyGraveyards';
import {
  BookIcon,
  CameraIcon,
  ChecklistIcon,
  EnvelopeIcon,
  FindIcon,
  HeadstoneIcon,
  KeyboardIcon,
  OnlineIcon,
  OrDivider,
  PhonePinIcon,
  PhotoToAppFlow,
} from '@/components/ParishIcons';
import { SUPER_ADMIN_EMAIL } from '@/lib/types';

export const metadata: Metadata = {
  title: 'For parishes and graveyards · LiveOnWith.me',
  description:
    'Put your parish burial register online, free. Anyone looking for a loved one’s grave can search a name, find the grave and get directions to it.',
};

type Step = { title: string; icon: React.ReactNode; body: React.ReactNode };

const steps: Step[] = [
  {
    title: 'Find your graveyard',
    icon: <FindIcon size={40} />,
    body: (
      <>
        Tap &ldquo;Show graveyards near me&rdquo; at the bottom of this page, or type its name.
        Then sign in with your email address. That&rsquo;s your account made.
      </>
    ),
  },
  {
    title: 'Tell us about your burial book',
    icon: <ChecklistIcon size={40} />,
    body: (
      <>
        Is it handwritten, typed, or on a computer? Does it have dates, ages, townlands? Tick the
        boxes. We use your answers to give you simple instructions.
      </>
    ),
  },
  {
    title: 'Put the names online',
    icon: <BookIcon size={40} />,
    body: null, // drawn by <NameOptions /> below
  },
  {
    title: 'Pin the graves (if you like)',
    icon: <PhonePinIcon size={40} />,
    body: (
      <>
        Walk the graveyard with your phone. Stand at a grave, find the name and tap{' '}
        <strong>&ldquo;Pin here&rdquo;</strong>. Now families are guided right to it. Do a few rows
        at a time, or skip this step altogether.
      </>
    ),
  },
];

const nameOptions: { icon: React.ReactNode; title: string; body: React.ReactNode }[] = [
  {
    icon: <CameraIcon size={36} />,
    title: 'Take photos of the book',
    body: (
      <>
        Our app can&rsquo;t read handwriting by itself, so a free app called <strong>ChatGPT</strong>{' '}
        does the typing in the middle. We give you the exact words to paste into ChatGPT, so it
        lays the names out the way our app needs.
        <PhotoToAppFlow />
        Not sure how? We&rsquo;ll guide you through it, one step at a time, once you sign up.
      </>
    ),
  },
  {
    icon: <KeyboardIcon size={36} />,
    title: 'Type the names in yourself',
    body: <>One grave at a time, on your phone or a computer. Only the surname is needed.</>,
  },
  {
    icon: <EnvelopeIcon size={36} />,
    title: 'Ask us to help',
    body: (
      <>
        Email{' '}
        <a href={`mailto:${SUPER_ADMIN_EMAIL}`} style={{ textDecoration: 'underline' }}>
          {SUPER_ADMIN_EMAIL}
        </a>{' '}
        and a real person will sort it out with you.
      </>
    ),
  },
];

const iconCircle = (size: number): React.CSSProperties => ({
  flex: `0 0 ${size}px`,
  width: size,
  height: size,
  borderRadius: '50%',
  background: 'var(--sage2)',
  color: 'var(--ink)',
  display: 'grid',
  placeItems: 'center',
});

/** Step 3: three ways to get the names in. Only one is needed, and says so. */
function NameOptions() {
  return (
    <div>
      <p style={{ margin: '0 0 12px' }}>
        <strong>Choose one way.</strong> You don&rsquo;t need to do all three.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>
        {nameOptions.map((o, i) => (
          <div key={o.title}>
            {i > 0 && <OrDivider />}
            <div
              className="optionCard"
              style={{
                border: '1px solid var(--line)',
                borderRadius: 16,
                padding: '14px 16px',
                background: 'white',
              }}
            >
              <div style={iconCircle(56)}>{o.icon}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 2 }}>{o.title}</div>
                <div style={{ fontSize: 17 }}>{o.body}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ margin: '12px 0 0', fontSize: 16 }}>
        Whichever way you choose, you see everything before it&rsquo;s saved.
      </p>
    </div>
  );
}

/** The whole idea at a glance: book, online, family finds the grave. */
function AtAGlance() {
  const items: { icon: React.ReactNode; label: string }[] = [
    { icon: <BookIcon size={46} />, label: 'Your parish burial book' },
    { icon: <OnlineIcon size={46} />, label: 'Goes online, free' },
    { icon: <HeadstoneIcon size={46} />, label: 'Families find the grave' },
  ];
  return (
    <div className="glanceStrip" aria-label="Your parish burial book goes online, free, so families can find the grave">
      {items.map((it, i) => (
        <div key={it.label} style={{ display: 'contents' }}>
          {i > 0 && (
            <div className="glanceArrow" aria-hidden="true">
              →
            </div>
          )}
          <div style={{ textAlign: 'center' }}>
            <div className="glanceCircle" style={{ ...iconCircle(84), width: undefined, height: undefined, flex: 'none', margin: '0 auto 8px' }}>
              {it.icon}
            </div>
            <div className="glanceLabel" style={{ fontWeight: 700, lineHeight: 1.3 }}>{it.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const faqs: { q: string; a: React.ReactNode }[] = [
  {
    q: 'Does it cost anything?',
    a: <>No. It&rsquo;s free for parishes and graveyards.</>,
  },
  {
    q: 'Who can see the register?',
    a: (
      <>
        Anyone can search it, so people can find a grave quickly and go to it. They see the
        names, dates, ages, townland, the row and plot, the inscription and the pin on the map.
        Anything you put in <strong>Private notes</strong> is only seen by you and your helpers.
      </>
    ),
  },
  {
    q: 'Could an upload change a family’s memorial?',
    a: (
      <>
        No. Uploads only change the register. They never touch a memorial page, and once a family
        has taken on a grave, it&rsquo;s locked. Nothing is linked automatically either: a family
        has to say &ldquo;Yes, this is the grave&rdquo; themselves, and can tell you about any
        mistake with one tap.
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
        anything private, leave those pages out, or type them in by hand instead. And remember
        the register can be searched by anyone, so leave out anything you wouldn&rsquo;t put on a
        noticeboard.
      </>
    ),
  },
  {
    q: 'Can we put something up at the graveyard?',
    a: (
      <>
        Yes. Once you&rsquo;re set up, download a poster with a QR code for the gate or the church
        porch. Visitors scan it with their phone and search for anyone buried there. Families&rsquo;
        memorial pages come up first, then your register.
      </>
    ),
  },
  {
    q: 'We have more than one graveyard.',
    a: (
      <>
        That&rsquo;s fine. Set up each one in turn with the same email address, and you can move
        between them from the registrar page. Each graveyard can have its own helpers too.
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
          Put your parish burial register online, free. Then anyone can type a name on
          LiveOnWith.me and find the grave: the graveyard, the row, the plot number, and
          directions right to it.
        </p>
        <style>{`
          .visuallyHidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
          .glanceStrip { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr) auto minmax(0,1fr); align-items: start; gap: 10px; margin: 26px 0 6px; }
          .glanceArrow { font-size: 30px; color: var(--sage); padding-top: 24px; }
          .glanceCircle { width: 84px; height: 84px; }
          .glanceLabel { font-size: 17px; }
          .stepCard { display: flex; gap: 18px; align-items: flex-start; }
          .optionCard { display: flex; gap: 14px; align-items: flex-start; }
          @media (max-width: 560px) {
            .glanceStrip { gap: 4px; }
            .glanceArrow { font-size: 22px; padding-top: 18px; }
            .glanceCircle { width: 62px; height: 62px; }
            .glanceCircle svg { width: 34px; height: 34px; }
            .glanceLabel { font-size: 14px; }
            .stepCard { flex-direction: column; gap: 10px; padding: 20px !important; }
            .optionCard { padding: 12px !important; }
            .optionCard > div:first-child { width: 46px !important; height: 46px !important; flex-basis: 46px !important; }
          }
        `}</style>
        <AtAGlance />
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
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
          {steps.map((s, i) => (
            <li key={s.title} className="card stepCard">
              <div style={{ position: 'relative', ...iconCircle(68) }}>
                {s.icon}
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: -6,
                    left: -6,
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: 'var(--ink)',
                    color: 'white',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 800,
                    fontSize: 15,
                  }}
                >
                  {i + 1}
                </span>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3 style={{ fontSize: 24, margin: '4px 0 8px' }}>
                  <span className="visuallyHidden">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <div>{s.body ?? <NameOptions />}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="section" style={{ maxWidth: 820 }}>
        <h2>What families see</h2>
        <p>
          Anyone can search a name and go straight to the grave. And when a family makes a
          memorial page and chooses your graveyard, they see something like this:
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
          page. If not, nothing happens. Uploads never change a memorial a family has made.
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
        <MyGraveyards title="Graveyards you already look after" />
        <p className="lead" style={{ margin: '0 auto 20px' }}>
          If you&rsquo;re in the parish now, let your phone show the graveyards closest to you.
        </p>
        <ButtonLink href="/cemetery/nearby?for=registrar" className="button">
          📍 Show graveyards near me
        </ButtonLink>
        <p className="muted" style={{ margin: '28px auto 12px', fontSize: 16 }}>
          Or type the name of the graveyard or church:
        </p>
        <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'left' }}>
          <CemeterySearch target="registrar" showNearby={false} />
        </div>
        <p className="muted" style={{ marginTop: 22, fontSize: 16, maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
          Look after more than one graveyard? Set up one, then come back here for the next. You can
          also add other helpers to each graveyard once it&rsquo;s set up.
        </p>
        <p className="muted" style={{ marginTop: 12, fontSize: 16 }}>
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
