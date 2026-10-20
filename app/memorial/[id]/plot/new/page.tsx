'use client';
// Dedicated plot-creation flow for a memorial. The memorial no longer stores
// cemetery data; the plot is the single home for "where is this person
// resting?". This page is the entry point when a keeper clicks the
// "Add a resting place" chip on the memorial — pick a cemetery, create the
// plot, land on the plot manager.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import type { Cemetery, Memorial } from '@/lib/types';
import { canEditMemorial } from '@/lib/roles';
import { createPlotForMemorial } from '@/lib/plot';
import { writeAudit } from '@/lib/audit';
import { PageSkeleton } from '@/components/Skeleton';
import CemeteryPicker from '@/components/CemeteryPicker';

export const dynamic = 'force-dynamic';

export default function NewPlotForMemorial({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [m, setM] = useState<Memorial | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Pick is held locally and only committed on confirm — Places autocomplete
  // misclicks are frequent and we don't want to spin up a Plot each time.
  const [cemeteryPick, setCemeteryPick] = useState<Cemetery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    params.then(({ id }) =>
      onAuthStateChanged(auth, async (u) => {
        if (!u) return router.push('/auth');
        const snap = await getDoc(doc(db, 'memorials', id));
        if (!snap.exists()) {
          setNotFound(true);
          return;
        }
        const data = { id: snap.id, ...(snap.data() as Omit<Memorial, 'id'>) };
        if (!canEditMemorial(u.uid, data)) {
          router.push('/dashboard');
          return;
        }
        // If the memorial is already attached to a plot, this page has no job.
        if (data.plotId) {
          router.replace(`/plot/${data.plotId}/manage`);
          return;
        }
        setM(data);
      }),
    );
  }, [params, router]);

  async function confirm() {
    if (!m || !auth.currentUser || !cemeteryPick) return;
    setBusy(true);
    setError('');
    try {
      const plotId = await createPlotForMemorial({
        memorial: m,
        cemetery: cemeteryPick,
      });
      await writeAudit({
        entityType: 'plot',
        entityId: plotId,
        action: 'linked_to_memorial',
        actorUid: auth.currentUser.uid,
        actorEmail: auth.currentUser.email || undefined,
        details: { memorialId: m.id },
      });
      router.push(`/plot/${plotId}/manage`);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong creating the plot.');
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <main className="shell">
        <div className="formCard">
          <h2>We couldn&rsquo;t find that memorial.</h2>
          <Link href="/dashboard" className="button secondary" style={{ marginTop: 16 }}>
            Back to your dashboard
          </Link>
        </div>
      </main>
    );
  }
  if (!m) return <PageSkeleton variant="form" label="Loading" />;

  return (
    <main className="shell">
      <div className="formCard">
        <div style={{ marginBottom: 14 }}>
          <Link href={`/memorial/${m.id}`} className="button secondary small">
            ← Back
          </Link>
        </div>
        <div className="eyebrow">The resting place</div>
        <h2>Where will people come to visit {m.fullName}?</h2>
        <p className="muted">
          Picking a cemetery here creates a plot — a shared record for everyone remembered at the
          same grave. You&rsquo;ll land on the plot page to drop a pin on the exact spot and grab
          the QR code for the headstone.
        </p>

        <div style={{ marginTop: 18 }}>
          <CemeteryPicker
            value={cemeteryPick}
            onChange={(next) => setCemeteryPick(next)}
          />
        </div>

        {error && (
          <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="button"
            onClick={confirm}
            disabled={busy || !cemeteryPick}
          >
            {busy
              ? 'Creating plot…'
              : cemeteryPick
                ? `Create plot at ${cemeteryPick.name || 'this cemetery'}`
                : 'Pick a cemetery to continue'}
          </button>
          <Link href={`/memorial/${m.id}`} className="button secondary">
            Cancel
          </Link>
        </div>
      </div>
    </main>
  );
}
