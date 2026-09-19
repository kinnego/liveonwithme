// Runtime config: pricing + quotas. Read from Firestore /configPublic/*
// with hard-coded defaults so the app still works on a fresh install.
//
// Cached in-memory per process. Admin console rewrites these docs;
// clients pick up new values on next fetch.

import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import {
  DEFAULT_PRICING,
  DEFAULT_QUOTAS,
  MediaQuotasConfig,
  PricingConfig,
} from './types';

let _pricingCache: { at: number; value: PricingConfig } | null = null;
let _quotasCache: { at: number; value: MediaQuotasConfig } | null = null;
const TTL_MS = 60_000;

export async function readPricing(): Promise<PricingConfig> {
  const now = Date.now();
  if (_pricingCache && now - _pricingCache.at < TTL_MS) return _pricingCache.value;

  if (!db) return DEFAULT_PRICING;
  try {
    const snap = await getDoc(doc(db, 'configPublic', 'pricing'));
    const value = snap.exists()
      ? { ...DEFAULT_PRICING, ...(snap.data() as Partial<PricingConfig>) }
      : DEFAULT_PRICING;
    _pricingCache = { at: now, value };
    return value;
  } catch {
    return DEFAULT_PRICING;
  }
}

export async function readQuotas(): Promise<MediaQuotasConfig> {
  const now = Date.now();
  if (_quotasCache && now - _quotasCache.at < TTL_MS) return _quotasCache.value;

  if (!db) return DEFAULT_QUOTAS;
  try {
    const snap = await getDoc(doc(db, 'configPublic', 'quotas'));
    const value = snap.exists()
      ? { ...DEFAULT_QUOTAS, ...(snap.data() as Partial<MediaQuotasConfig>) }
      : DEFAULT_QUOTAS;
    _quotasCache = { at: now, value };
    return value;
  } catch {
    return DEFAULT_QUOTAS;
  }
}

export function invalidateConfigCache() {
  _pricingCache = null;
  _quotasCache = null;
}

// Server-side equivalents (use firebase-admin) live in lib/config-admin.ts.
