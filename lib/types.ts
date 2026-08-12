export type MemorialVisibility = 'public' | 'private' | 'unlisted';

export interface Memorial {
  id: string;
  ownerId: string;
  slug: string;
  fullName: string;
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
