import { UserProfile, SUPER_ADMIN_EMAIL } from './types';

export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

export function isSuperAdmin(profile?: Pick<UserProfile, 'role' | 'email'> | null): boolean {
  if (!profile) return false;
  if (profile.role === 'super_admin') return true;
  return isSuperAdminEmail(profile.email);
}

export function isApprovedPartner(profile?: Pick<UserProfile, 'role' | 'partnerStatus'> | null): boolean {
  if (!profile) return false;
  return profile.role === 'partner' && profile.partnerStatus === 'approved';
}

export function canCreateReferrals(profile?: Pick<UserProfile, 'role' | 'partnerStatus' | 'email'> | null): boolean {
  return isSuperAdmin(profile) || isApprovedPartner(profile);
}
