// Fire-and-forget cache buster, called after a family-side write to the
// memorial (contribution approve/hide, memorial edit, clip edit, offline
// toggle). The ISR cache for /m/[slug] otherwise serves yesterday's HTML
// for up to an hour, which is a bad experience for the keeper who just
// hit save and refreshed the public link to share it.
//
// Fire-and-forget on purpose: the save already succeeded, and we don't
// want network flakiness to make the keeper think the save failed. A
// missed revalidate just means the public page falls back to its natural
// TTL — unpleasant, not broken.

import { auth } from './firebase-auth';

export async function revalidatePublicMemorial(memorialId: string): Promise<void> {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    await fetch('/api/memorial/revalidate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ memorialId }),
      keepalive: true,
    });
  } catch {
    // Swallow. See file header.
  }
}
