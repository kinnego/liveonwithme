// Client-side pricing selection — mirrors lib/pricing-admin.ts for the UI so
// the manage page can show the correct price before the user hits Go Live.
// The authoritative decision is still made server-side at checkout time.

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';

export async function isSecondaryOnPlot(
  memorialId: string,
  plotId: string,
): Promise<boolean> {
  if (!db) return false;
  const memberships = await getDocs(
    query(
      collection(db, 'plotMemberships'),
      where('plotId', '==', plotId),
      where('status', '==', 'approved'),
    ),
  );
  for (const m of memberships.docs) {
    const otherId = m.data().memorialId as string | undefined;
    if (!otherId || otherId === memorialId) continue;
    const other = await getDoc(doc(db, 'memorials', otherId));
    if (!other.exists()) continue;
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
