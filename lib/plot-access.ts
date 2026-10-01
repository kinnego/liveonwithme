// Server-side plot access check. Used by every plot-management API route and
// by the dedicated /api/plot/access endpoint the client calls to decide
// whether to render the editor UI.
//
// Access tiers, highest-privilege first:
//   admin        — listed in plotAdminUids
//   successor    — pre-approved administrator (plotAdminSuccessorUids)
//   super_admin  — platform operator
//   partner      — professional partner with an active referral linked to a
//                  memorial on this plot. Lets funeral directors / engravers
//                  prepare plaque artwork without round-tripping through a
//                  grieving family.

import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';

export type PlotAccessRole = 'admin' | 'successor' | 'super_admin' | 'partner';

export interface PlotAccessResult {
  allowed: boolean;
  role: PlotAccessRole | null;
  plot: DocumentSnapshot | null;
}

const ACTIVE_REFERRAL_STATUSES = new Set(['pending', 'claimed']);

export async function checkPlotAccess(
  db: Firestore,
  uid: string,
  plotId: string,
): Promise<PlotAccessResult> {
  const plotSnap = await db.collection('plots').doc(plotId).get();
  if (!plotSnap.exists) return { allowed: false, role: null, plot: null };
  const plot = plotSnap.data()!;

  const admins: string[] = Array.isArray(plot.plotAdminUids)
    ? plot.plotAdminUids
    : plot.plotAdminUid
      ? [plot.plotAdminUid]
      : [];
  if (admins.includes(uid)) return { allowed: true, role: 'admin', plot: plotSnap };

  const successors: string[] = Array.isArray(plot.plotAdminSuccessorUids)
    ? plot.plotAdminSuccessorUids
    : [];
  if (successors.includes(uid)) return { allowed: true, role: 'successor', plot: plotSnap };

  const userSnap = await db.collection('users').doc(uid).get();
  if (userSnap.exists && userSnap.data()?.role === 'super_admin') {
    return { allowed: true, role: 'super_admin', plot: plotSnap };
  }

  // Partner: at least one memorial on this plot is tied to a referral the
  // partner owns, and that referral is still active (not cancelled).
  const memorialsSnap = await db
    .collection('memorials')
    .where('plotId', '==', plotId)
    .where('partnerUid', '==', uid)
    .get();
  for (const m of memorialsSnap.docs) {
    const data = m.data();
    const referralId = typeof data.referralId === 'string' ? data.referralId : null;
    if (!referralId) continue;
    const refSnap = await db.collection('referrals').doc(referralId).get();
    if (refSnap.exists && ACTIVE_REFERRAL_STATUSES.has(refSnap.data()?.status)) {
      return { allowed: true, role: 'partner', plot: plotSnap };
    }
  }

  return { allowed: false, role: null, plot: plotSnap };
}
