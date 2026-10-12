// Firestore-backed sliding-window rate limiter.
//
// We're on serverless (Netlify functions) so in-memory counters don't work —
// each invocation can hit a cold instance. A small, atomic Firestore write
// per request is good enough for the volumes we expect, and the data is
// self-cleaning via the windowStart timestamp.
//
// Keys should be scoped to the caller: `${endpoint}:${ip}:${subject}` is a
// sensible default (prevents one abuser from exhausting another visitor's
// bucket, and prevents one visitor from exhausting across endpoints).

import { adminDb } from './firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export async function rateLimit(
  key: string,
  { max, windowSec }: { max: number; windowSec: number },
): Promise<RateLimitResult> {
  if (!key) {
    // Fail open on malformed key — don't block legitimate traffic because of
    // a programming mistake. The caller should log + fix.
    return { allowed: true, remaining: max, retryAfterSec: 0 };
  }

  const db: Firestore = adminDb();
  const ref = db.collection('rateLimits').doc(encodeKey(key));
  const now = Date.now();
  const windowMs = windowSec * 1000;

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data()! : null;
      const windowStart: number =
        data?.windowStart?.toMillis?.() ?? data?.windowStart ?? 0;
      const prevCount: number = data?.count ?? 0;

      let newCount: number;
      let newWindowStart: number;
      if (!data || now - windowStart >= windowMs) {
        newWindowStart = now;
        newCount = 1;
      } else {
        newWindowStart = windowStart;
        newCount = prevCount + 1;
      }

      const allowed = newCount <= max;

      if (allowed) {
        tx.set(ref, {
          count: newCount,
          windowStart: new Date(newWindowStart),
          updatedAt: new Date(now),
        });
      }

      const retryAfterSec = allowed
        ? 0
        : Math.max(1, Math.ceil((newWindowStart + windowMs - now) / 1000));

      return {
        allowed,
        remaining: Math.max(0, max - newCount),
        retryAfterSec,
      };
    });
  } catch (err) {
    // If Firestore is unavailable we fail open — a brief availability dip
    // shouldn't lock everyone out. Log so we can see it in Netlify logs.
    console.warn('rateLimit transaction failed, failing open', { key, err });
    return { allowed: true, remaining: max, retryAfterSec: 0 };
  }
}

// Firestore doc IDs can't contain '/', max 1500 bytes, no leading '.'. The
// easiest safe encoding is URL-safe base64 of the raw key.
function encodeKey(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url').slice(0, 1500);
}

// Pull the best-available client IP from the request. Netlify and most CDNs
// forward via x-forwarded-for; the leftmost entry is the original client.
// Falls back to a stable "unknown" bucket so we still throttle anonymous
// traffic in aggregate when the header is missing.
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip') || headers.get('x-nf-client-connection-ip');
  if (real) return real.trim();
  return 'unknown';
}
