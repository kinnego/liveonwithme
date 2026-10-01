export const metadata = { title: 'Privacy · LiveOnWith.me' };

export default function PrivacyPage() {
  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">Privacy</div>
        <h2>Memorials are private by default. We treat them that way.</h2>
        <p className="muted">
          LiveOnWith.me is built around a single idea: the memories a family trusts us with belong to the
          family. Nothing on this page is boilerplate — it describes exactly what we do and don&rsquo;t do
          with your information.
        </p>

        <h3>What we store</h3>
        <ul>
          <li>The memorial content itself: names, dates, written memories, photographs and voice notes.</li>
          <li>Account details for the person who created or manages the memorial (email, name).</li>
          <li>Technical records needed to keep the site running (sign-in sessions, basic request logs).</li>
        </ul>

        <h3>What we don&rsquo;t do</h3>
        <ul>
          <li>No analytics, advertising pixels or third-party trackers.</li>
          <li>No selling, renting or sharing of memorial content with anyone.</li>
          <li>No training of AI models on your memorials.</li>
        </ul>

        <h3>Cookies</h3>
        <p className="muted">
          We only set the cookies needed to keep you signed in while you&rsquo;re using the site. There are
          no tracking cookies and no advertising cookies. If you pay through Stripe for a partner service,
          Stripe sets its own cookies during that checkout — those are strictly necessary for the payment
          to work.
        </p>

        <h3>Who can see a memorial</h3>
        <p className="muted">
          Public memorials appear at <code>liveonwith.me/m/[slug]</code> and can be found by anyone with the
          link or who scans the plot QR code. Family-only memorials require sign-in. Private drafts are
          visible only to the owner. The person who owns the memorial controls which setting it has.
        </p>

        <h3>Deleting a memorial or your account</h3>
        <p className="muted">
          Email <a href="mailto:hello@freastar.com">hello@freastar.com</a> from the account&rsquo;s registered
          address and we&rsquo;ll remove the memorial, uploaded photos and voice notes, and the account record
          itself. We don&rsquo;t keep tombstoned copies after deletion.
        </p>

        <h3>Where the data lives</h3>
        <p className="muted">
          Memorial content is held in Firebase (operated by Google) and Cloudflare R2. Both run in regions
          chosen for proximity to Europe. We&rsquo;re the data controller; those services are our processors.
        </p>

        <p className="muted" style={{ marginTop: 30, fontSize: 13 }}>
          Questions, or a specific deletion request? Email{' '}
          <a href="mailto:hello@freastar.com">hello@freastar.com</a>.
        </p>
      </div>
    </main>
  );
}
