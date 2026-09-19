// Server-side pricing selection.
//
// The plot QR is engraved *once* and never changes. When a second family
// member is memorialised at the same plot, we're not creating a new physical
// asset — we're just adding a name to the page that the existing QR already
// points at. The discounted "secondary" price reflects that.
//
// "Secondary" = the memorial is joining a plot that already has at least one
// other live, paid memorial. First memorial on a plot always pays the full
// price, even if the plot was created for a memorial that was later deleted.

import { adminDb } from './firebase-admin';

// True if this memorial is joining a plot that already has ≥1 other paid,
// live memorial. Caller supplies memorialId + plotId to avoid a re-fetch.
export async function isSecondaryOnPlot(
  memorialId: string,
  plotId: string,
): Promise<boolean> {
  const memberships = await adminDb()
    .collection('plotMemberships')
    .where('plotId', '==', plotId)
    .where('status', '==', 'approved')
    .get();

  for (const m of memberships.docs) {
    const otherId = m.data().memorialId as string | undefined;
    if (!otherId || otherId === memorialId) continue;
    const other = await adminDb().collection('memorials').doc(otherId).get();
    if (!other.exists) continue;
    const data = other.data() as any;
    if (data.status !== 'live') continue;
    if (
      data.paymentStatus !== 'paid' &&
      data.paymentStatus !== 'paid_via_partner' &&
      data.paymentStatus !== 'paid_via_funeral_director'
    ) {
      continue;
    }
    return true;
  }
  return false;
}
