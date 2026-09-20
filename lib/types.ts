// Live On With Me — core types.
//
// Follow the architecture rules from the spec: stable IDs, Person→Memorial,
// Plot→Memorial(*many), QR→Plot, custody separate from ownership.
// Do not add a commission/payout model — partners pay wholesale directly.

// ─── Enums ───────────────────────────────────────────────────────────────────

export type MemorialVisibility = 'public' | 'private' | 'unlisted';

export type MemorialStatus = 'draft' | 'awaiting_payment' | 'live';

export type MemorialKind = 'memorial' | 'legacy';

export type PaymentStatus = 'unpaid' | 'paid' | 'paid_via_partner';

export type SalesChannel = 'direct' | 'partner';

export type UserRole = 'family' | 'partner' | 'super_admin';

export type PartnerStatus = 'pending' | 'approved' | 'suspended' | 'rejected';

export type PartnerType =
  | 'funeral_director'
  | 'stonemason'
  | 'priest_minister'
  | 'cemetery'
  | 'crematorium'
  | 'celebrant'
  | 'estate_service'
  | 'community_organisation'
  | 'general_reseller';

export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  funeral_director: 'Funeral director',
  stonemason: 'Stonemason',
  priest_minister: 'Priest or minister',
  cemetery: 'Cemetery',
  crematorium: 'Crematorium',
  celebrant: 'Celebrant',
  estate_service: 'Estate or legacy service',
  community_organisation: 'Community organisation',
  general_reseller: 'General reseller',
};

// ─── Content sub-types ───────────────────────────────────────────────────────

export interface Cemetery {
  name: string;
  address: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
}

// A cemetery record added by a member of the public because Google Places
// didn't list it (many small church graveyards and old burial grounds are
// missing). We store our own copy so families can attach memorials to it.
// The Firestore doc ID is a random Firestore ID; the placeId used on
// Memorial.cemetery is that ID prefixed with `c-` so the two ID spaces don't
// collide with Google's `ChIJ…` place IDs.
export interface CustomCemetery {
  id: string;
  name: string;
  /** Lowercased name for prefix search. */
  nameLower: string;
  address?: string;
  lat: number;
  lng: number;
  // At least one of these is present. Signed-in submitters get createdByUid;
  // anonymous submitters must supply an email so we can reach them if the
  // listing needs correction. Email is never shown publicly.
  createdByUid?: string;
  createdByEmail?: string;
  updatedByUid?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

// A user-filed report against a community-added cemetery. Reports are private
// (super-admin only) — the public page never shows them or their reason.
export type CemeteryReportStatus = 'open' | 'dismissed' | 'actioned';

export interface CemeteryReport {
  id: string;
  cemeteryId: string;
  reason: string;
  reporterEmail?: string;
  reporterUid?: string;
  status: CemeteryReportStatus;
  createdAt?: unknown;
  decidedAt?: unknown;
  decidedByUid?: string;
}

export type ContributionSource = 'family' | 'visitor';
export type ContributionAudience = 'public' | 'family_only';
export type GalleryDisplayMode = 'square' | 'natural';
export type ContributionMediaType = 'photo' | 'video' | 'audio' | 'text';

// ─── Person ──────────────────────────────────────────────────────────────────
// Stable identity for whoever the memorial is about.
// A person may be alive (legacy owner) or deceased (memorialized).

export interface Person {
  id: string;
  fullName: string;
  born?: string;
  died?: string;
  isLiving: boolean;
  createdByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

// ─── Memorial ────────────────────────────────────────────────────────────────
// Content about a Person. Custody may transfer between users; the Memorial
// document is stable, its URL is stable.

export interface Memorial {
  id: string;
  personId?: string;
  plotId?: string | null;

  // custody
  ownerId: string; // current custodian (stable field name for backward compat + rules)
  createdByUid?: string;
  successorUids?: string[]; // ordered: [primary, backup1, backup2, ...]

  kind?: MemorialKind; // 'memorial' (deceased) or 'legacy' (alive, self-created)

  // presentation
  slug: string;
  fullName: string;
  /** Lowercased fullName — enables case-insensitive prefix search from the homepage. Missing on legacy docs. */
  fullNameLower?: string;
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

  // lifecycle
  status: MemorialStatus;
  paymentStatus: PaymentStatus;
  salesChannel: SalesChannel;
  partnerUid?: string | null;    // if salesChannel === 'partner'
  referralId?: string | null;    // link to Referral doc

  // legacy (before-death) helpers
  legacyLastEditedAt?: unknown;

  publishedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

// ─── Contribution ────────────────────────────────────────────────────────────

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
  mediaType?: ContributionMediaType;
  focalX?: number;
  focalY?: number;
  createdAt?: unknown;
}

// ─── Plot ────────────────────────────────────────────────────────────────────
// Physical grave (or memorial location) representation.
// A Plot has one or more co-administrators (flat set, all equal) plus a
// separate ordered succession list that only kicks in if every current
// admin is unable to act.
// A Plot can host many Memorials (approved via PlotMembership).
// QR codes always resolve to a Plot, never a Person or Memorial directly.

export interface Plot {
  id: string;
  shortId: string;              // 8-char human-safe token for /p/[shortId] QR URLs
  name?: string;                // optional plot label ("Plot 34, Row C")
  cemetery: Cemetery;
  // Precise grave coordinates within the cemetery. When set, the public plot
  // page and memorial page surface a "walking directions to the grave" link
  // that opens in the visitor's maps app. Optional — the cemetery-level
  // coordinates already get people to the gate.
  lat?: number;
  lng?: number;
  // Flat set of co-admins — creator is always the first entry. Any admin
  // can act on the plot; any admin can add or remove other admins. Older
  // plot docs may still have `plotAdminUid` (singular) instead — read via
  // the `plotAdmins()` helper in lib/plot.ts which handles both shapes.
  plotAdminUids: string[];
  /** @deprecated Legacy single-admin field. Kept optional for old docs. */
  plotAdminUid?: string;
  plotAdminSuccessorUids: string[]; // ordered, succession-only
  createdByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

// ─── PlotMembership ──────────────────────────────────────────────────────────
// Join between a Memorial and a Plot, with an approval step.

export type PlotMembershipStatus = 'requested' | 'approved' | 'rejected';

export interface PlotMembership {
  id: string;
  plotId: string;
  memorialId: string;
  personId?: string;
  requestedByUid: string;
  status: PlotMembershipStatus;
  approvedByUid?: string;
  approvedAt?: unknown;
  createdAt?: unknown;
}

// ─── CustodyTransfer ─────────────────────────────────────────────────────────
// Nomination + acceptance flow for handing memorial custody to a successor.
// The URL never changes; only custodianUid on the Memorial.

export type CustodyTransferStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'cancelled';

export type CustodyNominationType = 'primary' | 'backup';

export interface CustodyTransfer {
  id: string;
  memorialId: string;
  fromUid: string;
  toEmail: string;
  toUidWhenAccepted?: string;
  token: string;
  nominationType: CustodyNominationType;
  status: CustodyTransferStatus;
  invitedAt?: unknown;
  respondedAt?: unknown;
  expiresAt?: unknown;
}

// ─── Partner application ─────────────────────────────────────────────────────

export interface PartnerApplication {
  id: string;
  applicantUid: string;
  applicantEmail: string;
  partnerType: PartnerType;
  businessName: string;
  contactName: string;
  contactPhone?: string;
  website?: string;
  notes?: string;
  status: PartnerStatus;
  decidedByUid?: string;
  decidedAt?: unknown;
  decisionNotes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

// ─── Succession request ──────────────────────────────────────────────────────
// Route for family when the person died without nominating a successor.

export type SuccessionRequestStatus = 'pending' | 'assigned' | 'resolved' | 'rejected';

export interface SuccessionRequest {
  id: string;
  memorialId?: string;              // optional if the memorial doesn't yet exist
  personName: string;
  requesterUid: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone?: string;
  requesterRelationship: string;
  preferredPartnerUid?: string;     // family may nominate a partner they know
  invitedPartnerEmail?: string;     // or invite a not-yet-partner
  status: SuccessionRequestStatus;
  assignedPartnerUid?: string;
  assignedToLoWMAdmin?: boolean;
  resolutionNotes?: string;
  resolvedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

// ─── Audit event ─────────────────────────────────────────────────────────────
// Immutable audit trail for consequential state changes.

export type AuditEntityType =
  | 'memorial'
  | 'plot'
  | 'plotMembership'
  | 'user'
  | 'partnerApplication'
  | 'referral'
  | 'payment'
  | 'custodyTransfer'
  | 'successionRequest';

export interface AuditEvent {
  id: string;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  actorUid: string;
  actorEmail?: string;
  details?: Record<string, unknown>;
  timestamp?: unknown;
}

// ─── User profile ────────────────────────────────────────────────────────────

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  role: UserRole;
  partnerType?: PartnerType;
  partnerStatus?: PartnerStatus;
  partnerApplicationId?: string;
  createdAt?: unknown;
}

// ─── Referral (partner→customer link) ────────────────────────────────────────
// Retained for the partner-onboards-a-family flow. No commission fields.
// Partner pays wholesale (€150) to LOWM at the point a memorial is created.

export type ReferralStatus = 'pending' | 'claimed' | 'cancelled';
export type WholesalePaymentStatus = 'unpaid' | 'paid' | 'refunded';

export interface Referral {
  id: string;
  partnerUid: string;

  // bereaved contact
  bereavedName: string;
  bereavedEmail: string;
  bereavedPhone?: string;
  bereavedRelationship?: string;

  // deceased info
  deceasedFullName: string;
  deceasedNickname?: string;
  deceasedShortName?: string;
  deceasedAddress?: string;
  deceasedBorn?: string;
  deceasedDied?: string;

  status: ReferralStatus;
  wholesalePaymentStatus: WholesalePaymentStatus;
  wholesalePaymentId?: string;
  wholesaleAmountCents: number;   // e.g. 15000 = €150.00

  claimedByUid?: string;
  memorialId?: string;

  createdAt?: unknown;
  updatedAt?: unknown;
}

// ─── Payment ─────────────────────────────────────────────────────────────────

export type PaymentProvider = 'stripe';
export type PaymentRecordStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';
// direct_memorial / partner_wholesale = first memorial on a plot (full price).
// secondary_* = 2nd+ memorial on the same plot (discounted — the plot QR is
// already engraved, so the marginal cost of adding another name is lower).
export type PaymentKind =
  | 'direct_memorial'
  | 'partner_wholesale'
  | 'secondary_memorial'
  | 'secondary_partner_wholesale';

export interface Payment {
  id: string;
  memorialId?: string;
  referralId?: string;
  customerId: string;
  kind: PaymentKind;
  amount: number;               // cents
  currency: string;
  status: PaymentRecordStatus;
  provider: PaymentProvider;
  providerPaymentId: string;
  salesChannel: SalesChannel;
  createdAt?: unknown;
  paidAt?: unknown;
}

// ─── Media quotas config ─────────────────────────────────────────────────────

export interface MediaQuotasConfig {
  photosPerMemorial: number;
  videosPerMemorial: number;
  videoDurationSecondsMax: number;
  audioMinutesPerMemorial: number;
  totalBytesPerMemorial: number;
  singleFileBytesMax: number;
}

export const DEFAULT_QUOTAS: MediaQuotasConfig = {
  photosPerMemorial: 300,
  videosPerMemorial: 3,
  videoDurationSecondsMax: 90,
  audioMinutesPerMemorial: 15,
  totalBytesPerMemorial: 2 * 1024 * 1024 * 1024, // 2 GB
  singleFileBytesMax: 100 * 1024 * 1024,          // 100 MB
};

// ─── Pricing config ──────────────────────────────────────────────────────────

export interface PricingConfig {
  directPriceCents: number;
  partnerWholesalePriceCents: number;
  // Second and subsequent memorials on the same plot. The QR is already
  // engraved on the stone and the plot page updates automatically, so we
  // charge less for each additional name.
  secondaryDirectPriceCents: number;
  secondaryPartnerWholesalePriceCents: number;
  currency: string;
}

export const DEFAULT_PRICING: PricingConfig = {
  directPriceCents: 19900, // €199.00
  partnerWholesalePriceCents: 15000, // €150.00
  secondaryDirectPriceCents: 15000, // €150.00 — 2nd+ memorial on same plot
  secondaryPartnerWholesalePriceCents: 10000, // €100.00 — 2nd+ via partner
  currency: 'eur',
};

// ─── Well-known super admin ──────────────────────────────────────────────────

export const SUPER_ADMIN_EMAIL = 'hello@freastar.com';
