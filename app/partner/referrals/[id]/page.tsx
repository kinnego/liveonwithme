'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function PartnerReferral({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState('');
  const [r, setR] = useState<any>();
  const [uid, setUid] = useState('');
  const [error, setError] = useState('');
  const [inviteState, setInviteState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [paying, setPaying] = useState(false);
  const [plotId, setPlotId] = useState<string | null>(null);
  const [verifyState, setVerifyState] = useState<'idle' | 'checking' | 'notFound' | 'stillPending' | 'error'>('idle');
  const router = useRouter();
  const search = useSearchParams();
  const justPaid = search.get('paid') === '1';

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  useEffect(() => {
    if (!id || !auth) return;
    let stop: (() => void) | undefined;
    const stopAuth = onAuthStateChanged(auth, async (u) => {
      stop?.();
      stop = undefined;
      if (!u) {
        setUid('');
        router.push('/auth');
        return;
      }
      setUid(u.uid);
      stop = onSnapshot(
        doc(db, 'referrals', id),
        (snap) => {
          if (!snap.exists()) {
            setError('This memorial link is no longer available.');
            return;
          }
          setR({ id: snap.id, ...snap.data() });
        },
        (err) => {
          // Swallow transient permission errors from sign-out / token refresh
          // races; a true access problem will manifest as the referral never
          // loading, which the UI already handles via the loading skeleton.
          console.warn('partner referral snapshot error', err?.code || err?.message);
        },
      );
    });
    return () => {
      stopAuth();
      stop?.();
    };
  }, [id, router]);

  // Auto-send invite once wholesale is paid and we haven't invited yet.
  useEffect(() => {
    if (!r || !uid) return;
    if (r.partnerUid !== uid) return;
    if (r.wholesalePaymentStatus !== 'paid') return;
    if (r.status !== 'pending') return;
    if (inviteState !== 'idle') return;
    if (justPaid) sendInvite();
  }, [r, uid, inviteState, justPaid]);

  // Once the family has claimed and attached the memorial to a plot, surface
  // a direct link into the plaque / QR designer. Partners can't read the
  // memorial doc client-side, so the plotId is fetched via a small server
  // endpoint that scopes the lookup to referrals they own.
  useEffect(() => {
    if (!r || !uid || r.partnerUid !== uid) return;
    if (r.status !== 'claimed' || !r.memorialId) {
      setPlotId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (!auth?.currentUser) return;
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/api/partner/referral-plot?referralIds=${encodeURIComponent(r.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setPlotId(data.plots?.[r.id] || null);
      } catch {
        /* best-effort — the link just won't show */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [r, uid]);

  async function sendInvite() {
    if (!r || !auth?.currentUser) return;
    setInviteState('sending');
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/partner/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ referralId: r.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send invite');
      setInviteState('sent');
    } catch (err: any) {
      setError(err.message);
      setInviteState('error');
    }
  }

  async function verifyWholesale(): Promise<'paid' | 'pending' | 'no_session' | 'error'> {
    if (!r || !auth?.currentUser) return 'error';
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/partner/verify-wholesale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ referralId: r.id }),
      });
      if (!res.ok) return 'error';
      const data = await res.json();
      if (data.status === 'paid') return 'paid';
      if (data.status === 'no_session') return 'no_session';
      return 'pending';
    } catch {
      return 'error';
    }
  }

  async function manualVerify() {
    setVerifyState('checking');
    const result = await verifyWholesale();
    if (result === 'paid') {
      // onSnapshot will pick up the status flip and re-render.
      setVerifyState('idle');
    } else if (result === 'no_session') {
      setVerifyState('notFound');
    } else if (result === 'pending') {
      setVerifyState('stillPending');
    } else {
      setVerifyState('error');
    }
  }

  // After returning from Stripe (?paid=1), the webhook usually flips the
  // referral within a second or two. In local dev (no `stripe listen`) and if
  // a prod webhook is ever missed, that update never arrives — so poll the
  // verify endpoint for a short window as a backstop. Stops as soon as the
  // snapshot reports paid.
  useEffect(() => {
    if (!justPaid || !r || !uid) return;
    if (r.partnerUid !== uid) return;
    if (r.wholesalePaymentStatus === 'paid') return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 6; // ~18s at 3s intervals
    const start = window.setTimeout(async function tick() {
      if (cancelled) return;
      attempts++;
      const result = await verifyWholesale();
      if (cancelled) return;
      if (result === 'paid') return; // snapshot takes over
      if (attempts >= maxAttempts) {
        setVerifyState((s) => (s === 'idle' ? 'stillPending' : s));
        return;
      }
      window.setTimeout(tick, 3000);
    }, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
    };
  }, [justPaid, r, uid]);

  async function payWholesale() {
    if (!r || !auth?.currentUser) return;
    setPaying(true);
    setError('');
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/partner/wholesale-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ referralId: r.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start payment');
      window.location.href = data.checkoutUrl;
    } catch (err: any) {
      setError(err.message);
      setPaying(false);
    }
  }

  if (error) {
    return (
      <main className="shell">
        <div className="card">
          <h3>Something went wrong</h3>
          <p className="muted">{error}</p>
          <Link href="/partner" className="button soft" style={{ marginTop: 12, display: 'inline-flex' }}>
            Back to your customers
          </Link>
        </div>
      </main>
    );
  }

  if (!r) return <PageSkeleton variant="detail" label="Loading referral" />;

  const paid = r.wholesalePaymentStatus === 'paid';
  const claimed = r.status === 'claimed';

  return (
    <main className="shell">
      <Link href="/partner" style={{ color: 'var(--sage)', fontSize: 14 }}>← Back to your customers</Link>
      <div className="formCard" style={{ marginTop: 12 }}>
        <div className="eyebrow">Customer setup</div>
        <h2 style={{ marginBottom: 4 }}>{r.deceasedFullName}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Family contact: <strong>{r.bereavedName}</strong>
          {r.bereavedRelationship && <> · {r.bereavedRelationship}</>}
          <br />
          <span style={{ fontSize: 13 }}>{r.bereavedEmail}</span>
        </p>

        <div className="card" style={{ marginTop: 20, background: paid ? '#dde5df' : '#f0e8d8', borderColor: paid ? '#a8bcae' : '#e0c890' }}>
          <div className="eyebrow" style={{ color: paid ? '#2f5b48' : '#8b6f30' }}>
            {paid ? 'Wholesale paid' : justPaid ? 'Confirming payment' : 'Payment pending'}
          </div>
          <p style={{ margin: '8px 0' }}>
            {paid ? (
              <>You paid €{(r.wholesaleAmountCents / 100).toFixed(2)} for this memorial. You bill the family separately.</>
            ) : justPaid && verifyState !== 'stillPending' && verifyState !== 'notFound' && verifyState !== 'error' ? (
              <>Confirming your payment with Stripe… this usually takes a few seconds.</>
            ) : justPaid && verifyState === 'notFound' ? (
              <>We couldn&rsquo;t find a Stripe session for this referral. If you paid, try again — otherwise start a new payment below.</>
            ) : justPaid ? (
              <>Stripe hasn&rsquo;t confirmed this payment yet. If you completed checkout, click <strong>Check with Stripe now</strong>. If something went wrong, you can start a new payment below.</>
            ) : (
              <>You need to pay €{(r.wholesaleAmountCents / 100).toFixed(2)} wholesale before the family can be invited.</>
            )}
          </p>
          {!paid && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {justPaid && (
                <button className="button" onClick={manualVerify} disabled={verifyState === 'checking'}>
                  {verifyState === 'checking' ? 'Checking Stripe…' : 'Check with Stripe now'}
                </button>
              )}
              {(!justPaid || verifyState === 'stillPending' || verifyState === 'notFound' || verifyState === 'error') && (
                <button
                  className={justPaid ? 'button secondary' : 'button'}
                  onClick={payWholesale}
                  disabled={paying}
                >
                  {paying ? 'Opening Stripe…' : justPaid ? 'Start a new payment' : `Pay €${(r.wholesaleAmountCents / 100).toFixed(2)} now`}
                </button>
              )}
            </div>
          )}
        </div>

        {claimed && (
          <div className="card" style={{ marginTop: 20 }}>
            <h3 style={{ marginTop: 0 }}>Memorial resources</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              View the memorial, or design one of two plaques for the family.
            </p>

            <div style={{ marginTop: 18 }}>
              <div className="eyebrow">The memorial page</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                <Link href={`/m/${r.memorialId}`} className="button secondary small">
                  View memorial
                </Link>
              </div>
            </div>

            <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
              <div className="eyebrow">Headstone — for the grave</div>
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
                The QR and plaque for the resting place, shared across everyone buried on the
                plot. One page covers the bare QR for engraving and the full designed plaque for
                mounting.
              </p>
              {plotId ? (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                  <Link href={`/plot/${plotId}/artwork`} className="button secondary small">
                    Headstone artwork
                  </Link>
                </div>
              ) : (
                <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
                  Available once {r.bereavedName || 'the family'} attaches a cemetery to the plot.
                </p>
              )}
            </div>

            <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
              <div className="eyebrow">Keepsake — for an individual</div>
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
                A personal QR or plaque for one person — mantelpiece, prayer card, pendant,
                memory box, or sold as a shop keepsake. One per memorial, not tied to the
                headstone.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                <Link href={`/memorial/${r.memorialId}/artwork`} className="button secondary small">
                  Memorial artwork
                </Link>
              </div>
            </div>
          </div>
        )}

        {paid && (
          <div className="card" style={{ marginTop: 20 }}>
            <h3 style={{ marginTop: 0 }}>Family invitation</h3>
            {claimed ? (
              <p className="muted">
                {r.bereavedName} has taken over the memorial.
              </p>
            ) : (
              <>
                <p className="muted">
                  A private link goes to <strong>{r.bereavedEmail}</strong>. When they open it and
                  confirm the same email, they become the memorial custodian.
                </p>
                <p className="muted" style={{ fontSize: 13 }}>
                  The memorial and QR code become available once {r.bereavedName || 'the family'}{' '}
                  claims and attaches a cemetery. Send the invite to get started.
                </p>
                {inviteState === 'sent' && (
                  <p style={{ color: '#2f5b48' }}>
                    Invite sent. If they don&rsquo;t see it, ask them to check spam.
                  </p>
                )}
                <button
                  className="button"
                  onClick={sendInvite}
                  disabled={inviteState === 'sending'}
                >
                  {inviteState === 'sending'
                    ? 'Sending…'
                    : inviteState === 'sent'
                      ? 'Resend invite'
                      : 'Send invite'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
