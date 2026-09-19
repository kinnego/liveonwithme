// Short URL — what QR codes encode. Resolves shortId → plotId and redirects
// to the full plot page. Kept server-rendered so the QR never links to a
// client-side lookup that might briefly show "not found".

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export default async function ShortPlot({
  params,
}: {
  params: Promise<{ shortId: string }>;
}) {
  const { shortId } = await params;

  try {
    const snap = await adminDb()
      .collection('plots')
      .where('shortId', '==', shortId.toUpperCase())
      .limit(1)
      .get();

    if (snap.empty) {
      return (
        <main className="shell">
          <div className="formCard center">
            <h2>We couldn&rsquo;t find this plot.</h2>
            <p className="muted">
              The link on the stone may have been mistyped, or the plot may have moved.
              If you scanned a QR code, please try again — and if it still doesn&rsquo;t work,
              email <a href="mailto:hello@freastar.com">hello@freastar.com</a>.
            </p>
            <Link href="/" className="button" style={{ marginTop: 20 }}>
              Return home
            </Link>
          </div>
        </main>
      );
    }

    redirect(`/plot/${snap.docs[0].id}`);
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err;
    return (
      <main className="shell">
        <div className="formCard center">
          <h2>Something went wrong looking that up.</h2>
          <p className="muted">Please try again in a moment.</p>
        </div>
      </main>
    );
  }
}
