// Keeper landing for a memorial. Renders the same visual layout as the
// public /m/[slug] page but with inline edit affordances, empty-state
// nudges, and a FAB linking to the advanced-settings page. Keeper
// authorisation is enforced by the client component — anyone hitting this
// URL without edit rights is redirected by the existing load flow.
//
// We skip server-side load entirely because the keeper might be viewing a
// draft or offline memorial that the server loader (which filters by
// visibility) would refuse. The client fetch inside MemorialView uses the
// signed-in user's token and reads the memorial directly from Firestore.

import type { Metadata } from 'next';
import MemorialView from '../../m/[slug]/MemorialView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Draft · LiveOnWith.me',
  robots: { index: false, follow: false },
};

export default async function KeeperMemorialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // MemorialView reads params.slug; forward the id under that key so the
  // existing client flow doesn't need a second parameter name.
  const forwarded = Promise.resolve({ slug: id });
  return <MemorialView params={forwarded} initialMemorial={null} mode="keeper" />;
}
