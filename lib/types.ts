export type MemorialVisibility = 'public' | 'private' | 'unlisted';

export interface Memorial {
  id: string;
  ownerId: string;
  slug: string;
  fullName: string;
  nickname?: string;
  shortName?: string;
  address?: string;
  born?: string;
  died?: string;
  heroPhotoUrl?: string;
  epitaph?: string;
  story?: string;
  visibility: MemorialVisibility;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Contribution {
  id: string;
  memorialId: string;
  contributorName: string;
  contributorEmail?: string;
  relationship?: string;
  memory?: string;
  photoUrl?: string;
  photoPath?: string;
  caption?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt?: unknown;
}

export type UserRole = 'family' | 'funeral_director';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  createdAt?: unknown;
}

export interface Referral {
  id: string;
  funeralDirectorUid: string;
  commissionAmount?: string;
  payoutReference?: string;
  bereavedName: string;
  bereavedEmail: string;
  bereavedPhone?: string;
  bereavedRelationship?: string;
  deceasedFullName: string;
  deceasedNickname?: string;
  deceasedShortName?: string;
  deceasedAddress?: string;
  deceasedBorn?: string;
  deceasedDied?: string;
  status: 'pending' | 'claimed';
  claimedByUid?: string;
  memorialId?: string;
  createdAt?: unknown;
}
