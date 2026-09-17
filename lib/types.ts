export type MemorialVisibility = 'public' | 'private' | 'unlisted';

export type MemorialStatus = 'draft' | 'awaiting_payment' | 'live';

export type PaymentStatus = 'unpaid' | 'paid' | 'paid_via_funeral_director';

export type SalesChannel = 'direct' | 'funeral_director';

export interface Cemetery {
  name: string;
  address: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
}

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
  ageAtDeath?: number | null;
  cemetery?: Cemetery | null;
  featuredContributionIds?: string[];
  galleryDisplayMode?: GalleryDisplayMode;
  heroPhotoUrl?: string;
  heroPhotoPath?: string;
  epitaph?: string;
  story?: string;
  visibility: MemorialVisibility;
  status: MemorialStatus;
  paymentStatus: PaymentStatus;
  salesChannel: SalesChannel;
  funeralDirectorId?: string | null;
  referralId?: string | null;
  publishedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ContributionSource = 'family' | 'visitor';
export type ContributionAudience = 'public' | 'family_only';
export type GalleryDisplayMode = 'square' | 'natural';

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
  source?: ContributionSource;
  audience?: ContributionAudience;
  focalX?: number;
  focalY?: number;
  createdAt?: unknown;
}

export type UserRole = 'family' | 'funeral_director';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  createdAt?: unknown;
}

export type ReferralStatus = 'pending' | 'claimed';
export type CommercialStatus = 'referred' | 'setup' | 'paid' | 'live';

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
  status: ReferralStatus;
  commercialStatus: CommercialStatus;
  claimedByUid?: string;
  memorialId?: string;
  customerPrice: number;
  liveOnWithMeAmount: number;
  commissionAmountEuro: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type PaymentProvider = 'stripe';
export type PaymentRecordStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';

export interface Payment {
  id: string;
  memorialId: string;
  customerId: string;
  amount: number;
  currency: string;
  status: PaymentRecordStatus;
  provider: PaymentProvider;
  providerPaymentId: string;
  salesChannel: SalesChannel;
  createdAt?: unknown;
  paidAt?: unknown;
}

export const MEMORIAL_PRICE_EUR = 199;
export const FUNERAL_DIRECTOR_COMMISSION_EUR = 49;
export const LIVEONWITHME_REVENUE_EUR = 150;
