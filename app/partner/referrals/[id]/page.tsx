'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged, sendSignInLinkToEmail } from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter, useSearchParams } from 'next/navigation';
import { writeAudit } from '@/lib/audit';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function PartnerReferral({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState('');
  const [r, setR] = useState<any>();
  const [uid, setUid] = useState('');
  const [error, setError] = useState('');
  const [inviteState, setInviteState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [paying, setPaying] = useState(false);
  const router = useRouter();
  const search = useSearchParams();
  const justPaid = search.get('paid') === '1';

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  useEffect(() => {
    if (!id || !auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push('/auth');
        return;
      }
      setUid(u.uid);
      return onSnapshot(doc(db, 'referrals', id), (snap) => {
        if (!snap.exists()) {
          setError('This memorial link is no longer available.');
          return;
        }
        setR({ id: snap.id, ...snap.data() });
      });
    });
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

  async function sendInvite() {
    if (!r || !auth) return;
    setInviteState('sending');
    try {
      await sendSignInLinkToEmail(auth, r.bereavedEmail, {
        url: `${window.location.origin}/claim/${r.id}`,
        handleCodeInApp: true,
      });
      window.localStorage.setItem('emailForSignIn', r.bereavedEmail);
      await updateDoc(doc(db, 'referrals', r.id), {
        updatedAt: serverTimestamp(),
      });
      await writeAudit({
        entityType: 'referral',
        entityId: r.id,
        action: 'invite_sent',
        actorUid: uid,
        details: { bereavedEmail: r.bereavedEmail },
      });
      setInviteState('sent');
    } catch (err: any) {
      setError(err.message);
      setInviteState('error');
    }
  }

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
            {paid ? 'Wholesale paid' : 'Payment pending'}
          </div>
          <p style={{ margin: '8px 0' }}>
            {paid ? (
              <>You paid €{(r.wholesaleAmountCents / 100).toFixed(2)} for this memorial. You bill the family separately.</>
            ) : justPaid ? (
              <>Confirming your payment with Stripe… this can take a few seconds.</>
            ) : (
              <>You need to pay €{(r.wholesaleAmountCents / 100).toFixed(2)} wholesale before the family can be invited.</>
            )}
          </p>
          {!paid && (
            <button className="button" onClick={payWholesale} disabled={paying}>
              {paying ? 'Opening Stripe…' : `Pay €${(r.wholesaleAmountCents / 100).toFixed(2)} now`}
            </button>
          )}
        </div>

        {paid && (
          <div className="card" style={{ marginTop: 20 }}>
            <h3 style={{ marginTop: 0 }}>Family invitation</h3>
            {claimed ? (
              <p className="muted">
                {r.bereavedName} has taken over the memorial. You can{' '}
                <Link href={`/m/${r.memorialId}`} style={{ color: 'var(--sage)', textDecoration: 'underline' }}>
                  view it
                </Link>{' '}
                any time.
              </p>
            ) : (
              <>
                <p className="muted">
                  A private link goes to <strong>{r.bereavedEmail}</strong>. When they open it and
                  confirm the same email, they become the memorial custodian.
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
