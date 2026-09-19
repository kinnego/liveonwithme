'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import {
  DEFAULT_PRICING,
  DEFAULT_QUOTAS,
  MediaQuotasConfig,
  PricingConfig,
  UserProfile,
} from '@/lib/types';
import { writeAudit } from '@/lib/audit';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type Access = 'checking' | 'ok' | 'denied';

export default function AdminConfig() {
  const [access, setAccess] = useState<Access>('checking');
  const [pricing, setPricing] = useState<PricingConfig>(DEFAULT_PRICING);
  const [quotas, setQuotas] = useState<MediaQuotasConfig>(DEFAULT_QUOTAS);
  const [saving, setSaving] = useState<'pricing' | 'quotas' | null>(null);
  const [message, setMessage] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return router.push('/auth');
      const [profSnap, priceSnap, quotaSnap] = await Promise.all([
        getDoc(doc(db, 'users', u.uid)),
        getDoc(doc(db, 'configPublic', 'pricing')),
        getDoc(doc(db, 'configPublic', 'quotas')),
      ]);
      const prof = profSnap.exists() ? (profSnap.data() as UserProfile) : null;
      if (!isSuperAdmin(prof)) {
        setAccess('denied');
        return;
      }
      setAccess('ok');
      if (priceSnap.exists()) setPricing({ ...DEFAULT_PRICING, ...(priceSnap.data() as any) });
      if (quotaSnap.exists()) setQuotas({ ...DEFAULT_QUOTAS, ...(quotaSnap.data() as any) });
    });
  }, [router]);

  async function savePricing() {
    if (!auth.currentUser) return;
    setSaving('pricing');
    setMessage('');
    try {
      await setDoc(
        doc(db, 'configPublic', 'pricing'),
        { ...pricing, updatedAt: serverTimestamp() },
        { merge: true }
      );
      await writeAudit({
        entityType: 'payment',
        entityId: 'configPublic/pricing',
        action: 'pricing_updated',
        actorUid: auth.currentUser.uid,
        actorEmail: auth.currentUser.email || undefined,
        details: { pricing },
      });
      setMessage('Pricing saved.');
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(null);
    }
  }

  async function saveQuotas() {
    if (!auth.currentUser) return;
    setSaving('quotas');
    setMessage('');
    try {
      await setDoc(
        doc(db, 'configPublic', 'quotas'),
        { ...quotas, updatedAt: serverTimestamp() },
        { merge: true }
      );
      await writeAudit({
        entityType: 'memorial',
        entityId: 'configPublic/quotas',
        action: 'quotas_updated',
        actorUid: auth.currentUser.uid,
        actorEmail: auth.currentUser.email || undefined,
        details: { quotas },
      });
      setMessage('Quotas saved.');
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(null);
    }
  }

  if (access === 'checking') return <PageSkeleton variant="form" label="Checking access" />;
  if (access === 'denied')
    return (
      <main className="shell">
        <div className="card">This area is for site administrators.</div>
      </main>
    );

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Admin · config</div>
          <h2 style={{ marginBottom: 0 }}>Pricing & media quotas</h2>
        </div>
        <Link href="/admin" className="button secondary">
          Back to console
        </Link>
      </div>

      {message && (
        <div className="card" style={{ background: '#fffdf9', marginBottom: 20 }}>
          <p style={{ margin: 0 }}>{message}</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>Pricing</h3>
        <p className="muted">All values in cents. €199.00 = 19900.</p>

        <div className="twoCol">
          <div>
            <label>Direct price (cents)</label>
            <input
              type="number"
              value={pricing.directPriceCents}
              onChange={(e) => setPricing({ ...pricing, directPriceCents: Number(e.target.value) })}
            />
          </div>
          <div>
            <label>Partner wholesale (cents)</label>
            <input
              type="number"
              value={pricing.partnerWholesalePriceCents}
              onChange={(e) => setPricing({ ...pricing, partnerWholesalePriceCents: Number(e.target.value) })}
            />
          </div>
        </div>

        <p className="muted" style={{ fontSize: 13, marginTop: 14, marginBottom: 4 }}>
          Second and subsequent memorials on the same plot (the QR is already engraved).
        </p>
        <div className="twoCol">
          <div>
            <label>Secondary direct price (cents)</label>
            <input
              type="number"
              value={pricing.secondaryDirectPriceCents}
              onChange={(e) => setPricing({ ...pricing, secondaryDirectPriceCents: Number(e.target.value) })}
            />
          </div>
          <div>
            <label>Secondary partner wholesale (cents)</label>
            <input
              type="number"
              value={pricing.secondaryPartnerWholesalePriceCents}
              onChange={(e) => setPricing({ ...pricing, secondaryPartnerWholesalePriceCents: Number(e.target.value) })}
            />
          </div>
        </div>

        <label>Currency (Stripe code)</label>
        <input
          value={pricing.currency}
          onChange={(e) => setPricing({ ...pricing, currency: e.target.value.toLowerCase() })}
        />

        <button className="button" style={{ marginTop: 16 }} disabled={saving === 'pricing'} onClick={savePricing}>
          {saving === 'pricing' ? 'Saving…' : 'Save pricing'}
        </button>
      </div>

      <div className="card">
        <h3>Media quotas</h3>
        <p className="muted">Per-memorial defaults. Families reaching a limit are contacted before uploads fail.</p>

        <div className="twoCol">
          <div>
            <label>Photos per memorial</label>
            <input
              type="number"
              value={quotas.photosPerMemorial}
              onChange={(e) => setQuotas({ ...quotas, photosPerMemorial: Number(e.target.value) })}
            />
          </div>
          <div>
            <label>Videos per memorial</label>
            <input
              type="number"
              value={quotas.videosPerMemorial}
              onChange={(e) => setQuotas({ ...quotas, videosPerMemorial: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="twoCol">
          <div>
            <label>Max single video length (seconds)</label>
            <input
              type="number"
              value={quotas.videoDurationSecondsMax}
              onChange={(e) => setQuotas({ ...quotas, videoDurationSecondsMax: Number(e.target.value) })}
            />
          </div>
          <div>
            <label>Audio minutes per memorial</label>
            <input
              type="number"
              value={quotas.audioMinutesPerMemorial}
              onChange={(e) => setQuotas({ ...quotas, audioMinutesPerMemorial: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="twoCol">
          <div>
            <label>Total bytes per memorial</label>
            <input
              type="number"
              value={quotas.totalBytesPerMemorial}
              onChange={(e) => setQuotas({ ...quotas, totalBytesPerMemorial: Number(e.target.value) })}
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {Math.round(quotas.totalBytesPerMemorial / (1024 * 1024 * 1024) * 100) / 100} GB
            </p>
          </div>
          <div>
            <label>Single file max (bytes)</label>
            <input
              type="number"
              value={quotas.singleFileBytesMax}
              onChange={(e) => setQuotas({ ...quotas, singleFileBytesMax: Number(e.target.value) })}
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {Math.round(quotas.singleFileBytesMax / (1024 * 1024))} MB
            </p>
          </div>
        </div>

        <button className="button" style={{ marginTop: 16 }} disabled={saving === 'quotas'} onClick={saveQuotas}>
          {saving === 'quotas' ? 'Saving…' : 'Save quotas'}
        </button>
      </div>
    </main>
  );
}
