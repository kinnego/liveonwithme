import { Memorial, UserProfile, SUPER_ADMIN_EMAIL } from './types';

export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

// Trust only the role field — the email on the profile doc is user-writable
// (Firestore rules only lock role + partnerStatus), so falling back to the
// email would let anyone grant themselves admin by overwriting the field.
// At signup `ensureUserProfile` seeds role from the verified Auth token,
// and the rules only allow a `super_admin` role on creation when the Auth
// token's email matches and is verified — see firestore.rules.
export function isSuperAdmin(profile?: Pick<UserProfile, 'role'> | null): boolean {
  return profile?.role === 'super_admin';
}

export function isApprovedPartner(profile?: Pick<UserProfile, 'role' | 'partnerStatus'> | null): boolean {
  if (!profile) return false;
  return profile.role === 'partner' && profile.partnerStatus === 'approved';
}

export function canCreateReferrals(profile?: Pick<UserProfile, 'role' | 'partnerStatus' | 'email'> | null): boolean {
  return isSuperAdmin(profile) || isApprovedPartner(profile);
}

// Day-to-day editing rights: owner + co-managers. Super admins fall through
// to their own branch where callers care (edit routes don't need admin bypass).
export function canEditMemorial(
  uid: string | null | undefined,
  memorial: Pick<Memorial, 'ownerId' | 'coManagerUids'> | null | undefined,
): boolean {
  if (!uid || !memorial) return false;
  if (memorial.ownerId === uid) return true;
  return (memorial.coManagerUids || []).includes(uid);
}

// Owner-only ops: inviting/removing co-managers, nominating successors,
// publishing, deleting.
export function isMemorialOwner(
  uid: string | null | undefined,
  memorial: Pick<Memorial, 'ownerId'> | null | undefined,
): boolean {
  return !!uid && !!memorial && memorial.ownerId === uid;
}
