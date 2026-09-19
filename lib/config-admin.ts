// Server-side (firebase-admin) config readers. Same shape as lib/config.ts but
// uses the admin SDK so it works inside API routes.

import { adminDb } from './firebase-admin';
import {
  DEFAULT_PRICING,
  DEFAULT_QUOTAS,
  MediaQuotasConfig,
  PricingConfig,
} from './types';

export async function readPricingAdmin(): Promise<PricingConfig> {
  try {
    const snap = await adminDb().collection('configPublic').doc('pricing').get();
    if (!snap.exists) return DEFAULT_PRICING;
    return { ...DEFAULT_PRICING, ...(snap.data() as Partial<PricingConfig>) };
  } catch {
    return DEFAULT_PRICING;
  }
}

export async function readQuotasAdmin(): Promise<MediaQuotasConfig> {
  try {
    const snap = await adminDb().collection('configPublic').doc('quotas').get();
    if (!snap.exists) return DEFAULT_QUOTAS;
    return { ...DEFAULT_QUOTAS, ...(snap.data() as Partial<MediaQuotasConfig>) };
  } catch {
    return DEFAULT_QUOTAS;
  }
}
