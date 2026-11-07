'use client';
// Tiny inline dot that fades in while the parent <Link> is still navigating.
// Must be rendered as a descendant of a next/link `<Link>`. The hint is
// invisible until ~100 ms into the navigation, so fast transitions don't
// flash it.

import { useLinkStatus } from 'next/link';

export default function LinkPendingHint() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`link-hint ${pending ? 'is-pending' : ''}`} />;
}
