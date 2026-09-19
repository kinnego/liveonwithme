export const metadata = { title: 'Fair-use terms · LiveOnWith.me' };

export default function TermsPage() {
  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">Fair-use terms</div>
        <h2>Room for a lifetime of memories, not a data warehouse.</h2>
        <p className="muted">
          A Live On With Me memorial is meant to feel like a beautiful digital family album — the photos,
          voices and stories that a family never wants to lose. Our pricing works because most memorials
          settle into a size that is generous, but not unlimited.
        </p>

        <h3>What we host</h3>
        <ul>
          <li>Photographs of the person and their life.</li>
          <li>Short voice notes and video clips that capture their story.</li>
          <li>Written memories from family, friends and community.</li>
          <li>Cemetery location and plot information when families choose to share it.</li>
        </ul>

        <h3>What we don&rsquo;t host</h3>
        <ul>
          <li>General cloud storage or photo backup for a person&rsquo;s wider media library.</li>
          <li>Long-form or feature-length video archives.</li>
          <li>Third-party content that a family does not have the right to share.</li>
        </ul>

        <h3>Sensible limits</h3>
        <p className="muted">
          Every memorial has a generous default allowance for photos, video minutes and total storage.
          If a family reaches that limit, we&rsquo;ll get in touch to talk about how much room is really
          needed — we&rsquo;d rather have a conversation than fail an upload silently.
        </p>

        <p className="muted" style={{ marginTop: 30, fontSize: 13 }}>
          Questions? Email <a href="mailto:hello@freastar.com">hello@freastar.com</a>.
        </p>
      </div>
    </main>
  );
}
