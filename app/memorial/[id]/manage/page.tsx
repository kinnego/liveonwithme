'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  doc,
  getDoc,
  collection,
  onSnapshot,
  query,
  where,
  updateDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { ensurePlotForMemorial } from '@/lib/plot';
import { writeAudit } from '@/lib/audit';
import { longToken } from '@/lib/ids';
import { readQuotas, readPricing } from '@/lib/config';
import { isSecondaryOnPlot } from '@/lib/pricing';
import { DEFAULT_PRICING, DEFAULT_QUOTAS, MediaQuotasConfig, PricingConfig } from '@/lib/types';
import { PageSkeleton } from '@/components/Skeleton';
import PlotLocationEditor from '@/components/PlotLocationEditor';

function humanBytes(n: number): string {
  if (!n || n < 1024) return `${Math.max(0, n || 0)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const dynamic = 'force-dynamic';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

function ContributionPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (path) {
      setUrl(`${R2_PUBLIC_URL}/${path}`);
    }
  }, [path]);

  if (!url) return <div className="thumb" />;
  return (
    <div className="thumb">
      <img src={url} alt="Submitted" />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string; label: string }> = {
    draft: { bg: '#f0e8d8', fg: '#8b6f30', label: 'Draft' },
    awaiting_payment: { bg: '#ffe8cc', fg: '#a05a00', label: 'Awaiting payment' },
    live: { bg: '#dde5df', fg: '#2f5b48', label: 'Live' },
  };
  const c = colors[status] || colors.draft;
  return (
    <span
      style={{
        display: 'inline-block',
        borderRadius: 999,
        padding: '5px 12px',
        fontSize: 12,
        fontWeight: 750,
        background: c.bg,
        color: c.fg,
      }}
    >
      {c.label}
    </span>
  );
}

export default function Manage({ params }: { params: Promise<{ id: string }> }) {
  const [m, setM] = useState<any>();
  const [items, setItems] = useState<any[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [linkingPlot, setLinkingPlot] = useState(false);
  const [plotError, setPlotError] = useState('');
  const [pendingTransfers, setPendingTransfers] = useState<any[]>([]);
  const [successorEmail, setSuccessorEmail] = useState('');
  const [successorType, setSuccessorType] = useState<'backup' | 'primary'>('backup');
  const [nominationError, setNominationError] = useState('');
  const [nominationLink, setNominationLink] = useState('');
  const [savingNomination, setSavingNomination] = useState(false);
  const [quotas, setQuotas] = useState<MediaQuotasConfig>(DEFAULT_QUOTAS);
  const [usageBytes, setUsageBytes] = useState<number>(0);
  const [pricing, setPricing] = useState<PricingConfig>(DEFAULT_PRICING);
  const [isSecondary, setIsSecondary] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let stopContrib: (() => void) | undefined;
    let stopTransfers: (() => void) | undefined;
    let stopAll: (() => void) | undefined;
    let stopAuth: (() => void) | undefined;
    const teardown = () => {
      stopContrib?.();
      stopTransfers?.();
      stopAll?.();
      stopContrib = undefined;
      stopTransfers = undefined;
      stopAll = undefined;
    };
    params.then(({ id }) => {
      stopAuth = onAuthStateChanged(auth, async (u) => {
        // Tear down first: on signout the queries would re-evaluate under no
        // auth and throw permission-denied.
        teardown();
        if (!u) {
          router.push('/auth');
          return;
        }
        const snap = await getDoc(doc(db, 'memorials', id));
        if (!snap.exists() || snap.data().ownerId !== u.uid) return router.push('/dashboard');
        const memData: any = { id: snap.id, ...snap.data() };
        setM(memData);
        stopContrib = onSnapshot(
          query(
            collection(db, 'contributions'),
            where('memorialId', '==', id),
            where('status', '==', 'pending')
          ),
          (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        );
        stopTransfers = onSnapshot(
          query(
            collection(db, 'custodyTransfers'),
            where('memorialId', '==', id),
            where('fromUid', '==', u.uid),
            where('status', '==', 'pending')
          ),
          (s) => setPendingTransfers(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        );
        stopAll = onSnapshot(
          query(collection(db, 'contributions'), where('memorialId', '==', id)),
          (s) => {
            let sum = memData.heroPhotoSize || 0;
            s.forEach((d) => {
              const data = d.data() as any;
              if (typeof data.sizeBytes === 'number') sum += data.sizeBytes;
            });
            setUsageBytes(sum);
          }
        );
        readQuotas().then(setQuotas).catch(() => {});
        readPricing().then(setPricing).catch(() => {});
        if (memData.plotId) {
          isSecondaryOnPlot(id, memData.plotId)
            .then(setIsSecondary)
            .catch(() => {});
        }
      });
    });
    return () => {
      stopAuth?.();
      teardown();
    };
  }, [params, router]);

  async function refreshMemorial() {
    if (!m) return;
    const snap = await getDoc(doc(db, 'memorials', m.id));
    if (snap.exists()) setM({ id: snap.id, ...snap.data() });
  }

  async function goLive() {
    if (!m) return;
    setPublishing(true);
    setPublishError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/memorial/go-live', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ memorialId: m.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      await refreshMemorial();
    } catch (err: any) {
      setPublishError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  async function contribStatus(id: string, value: string) {
    await updateDoc(doc(db, 'contributions', id), { status: value });
  }

  async function nominate() {
    if (!m || !auth.currentUser) return;
    if (!successorEmail.trim()) {
      setNominationError('Please add an email address for the person you\u2019re nominating.');
      return;
    }
    setSavingNomination(true);
    setNominationError('');
    setNominationLink('');
    try {
      const token = longToken(32);
      const ref = await addDoc(collection(db, 'custodyTransfers'), {
        memorialId: m.id,
        fromUid: auth.currentUser.uid,
        toEmail: successorEmail.trim().toLowerCase(),
        token,
        nominationType: successorType,
        status: 'pending',
        invitedAt: serverTimestamp(),
      });
      await writeAudit({
        entityType: 'custodyTransfer',
        entityId: ref.id,
        action: 'invited',
        actorUid: auth.currentUser.uid,
        actorEmail: auth.currentUser.email || undefined,
        details: {
          memorialId: m.id,
          toEmail: successorEmail.trim().toLowerCase(),
          nominationType: successorType,
        },
      });
      const link = `${window.location.origin}/custody/accept/${token}`;
      setNominationLink(link);
      setSuccessorEmail('');
    } catch (err: any) {
      setNominationError(err.message || 'Something went wrong sending the invitation.');
    } finally {
      setSavingNomination(false);
    }
  }

  async function cancelNomination(id: string) {
    if (!auth.currentUser) return;
    await updateDoc(doc(db, 'custodyTransfers', id), {
      status: 'cancelled',
      respondedAt: serverTimestamp(),
    });
    await writeAudit({
      entityType: 'custodyTransfer',
      entityId: id,
      action: 'cancelled',
      actorUid: auth.currentUser.uid,
      actorEmail: auth.currentUser.email || undefined,
    });
  }

  async function linkPlot() {
    if (!m || !auth.currentUser) return;
    setLinkingPlot(true);
    setPlotError('');
    try {
      const plotId = await ensurePlotForMemorial(m);
      if (!plotId) {
        setPlotError('Please add a cemetery to the memorial first so we know where the plot is.');
        return;
      }
      await writeAudit({
        entityType: 'plot',
        entityId: plotId,
        action: 'linked_to_memorial',
        actorUid: auth.currentUser.uid,
        actorEmail: auth.currentUser.email || undefined,
        details: { memorialId: m.id },
      });
      await refreshMemorial();
    } catch (err: any) {
      setPlotError(err.message || 'Something went wrong linking the plot.');
    } finally {
      setLinkingPlot(false);
    }
  }

  async function download(path: string, name: string) {
    const url = `${R2_PUBLIC_URL}/${path}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'memory-photo';
    a.target = '_blank';
    a.click();
  }

  if (!m) return <PageSkeleton variant="detail" label="Opening controls" />;

  const isDraft = m.status === 'draft';
  const isLive = m.status === 'live';
  const isAwaitingPayment = m.status === 'awaiting_payment';
  const isPartnerPaid = m.paymentStatus === 'paid_via_partner' || m.paymentStatus === 'paid_via_funeral_director';
  const isLegacy = m.kind === 'legacy';
  const pageWord = isLegacy ? 'page' : 'memorial';
  const pageWordCap = isLegacy ? 'Page' : 'Memorial';
  const firstName = m.fullName.split(' ')[0];
  const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}/m/${m.slug}` : `/m/${m.slug}`;
  const priceCents = isSecondary ? pricing.secondaryDirectPriceCents : pricing.directPriceCents;
  const priceEur = Math.round(priceCents / 100);

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">{isLegacy ? 'Your page' : 'Family controls'}</div>
          <h2 style={{ marginBottom: 5 }}>{m.fullName}</h2>
          <p className="muted" style={{ margin: 0 }}>
            <StatusBadge status={m.status} />
            {isPartnerPaid && (
              <span style={{ marginLeft: 10, fontSize: 13 }}>
                · Set up for you by a partner
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/dashboard" className="button secondary">
            ← Dashboard
          </Link>
          <Link href={`/m/${m.slug}`} className="button secondary">
            {isLive ? `View ${pageWord}` : 'Preview'}
          </Link>
        </div>
      </div>

      {/* Go Live section */}
      {!isLive && (
        <div
          className="card"
          style={{
            marginBottom: 30,
            background: 'linear-gradient(135deg, #fffdf9, #f0e8d8)',
            borderColor: '#e0c890',
          }}
        >
          <div className="eyebrow">Ready when you are</div>
          <h3 style={{ marginTop: 10 }}>
            {isLegacy
              ? `Publish your ${pageWord}`
              : `Make ${firstName}'s ${pageWord} live`}
          </h3>
          {isPartnerPaid ? (
            <p className="muted">
              Your partner has already covered the cost. When you&rsquo;re ready, publish the
              {' '}{pageWord} so family and friends can visit it and share their memories.
            </p>
          ) : isLegacy ? (
            <p className="muted">
              Take your time. Nothing here goes anywhere until you&rsquo;re ready. Publishing
              makes the page reachable at its link (you still choose who can see it). A one-time
              fee of <strong>€{priceEur}</strong> covers hosting for life, so it&rsquo;s here for
              whenever it&rsquo;s needed.
            </p>
          ) : (
            <p className="muted">
              Take your time building the memorial. When you're ready, going live activates the
              memorial for family and friends. A one-time fee of <strong>€{priceEur}</strong> covers
              hosting for life.
            </p>
          )}

          {publishError && (
            <p style={{ color: '#a94442', marginTop: 12, fontSize: 14 }}>{publishError}</p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <button className="button" onClick={goLive} disabled={publishing}>
              {publishing
                ? 'Working…'
                : isPartnerPaid
                  ? 'Go Live'
                  : `Go Live · €${priceEur}`}
            </button>
            <Link href={`/m/${m.slug}`} className="button secondary">
              Preview first
            </Link>
          </div>

          {isAwaitingPayment && !isPartnerPaid && (
            <p className="muted" style={{ marginTop: 15, fontSize: 13 }}>
              You started checkout but payment wasn't completed. Click Go Live to try again.
            </p>
          )}
        </div>
      )}

      {isLive && (
        <div
          className="card"
          style={{
            marginBottom: 30,
            background: 'linear-gradient(135deg, #fffdf9, #dde5df)',
            borderColor: '#a8bcae',
          }}
        >
          <div className="eyebrow">{pageWordCap} is live</div>
          <h3 style={{ marginTop: 10 }}>
            {isLegacy ? `Share your ${pageWord}` : `Share ${firstName}'s ${pageWord}`}
          </h3>
          <p className="muted">
            {isLegacy
              ? `Your page is live at the link below. Share it with whoever you'd like, or just keep the link somewhere safe for when it's needed.`
              : `This memorial is live and accessible via the link below. Share it with family and friends.`}
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <button
              className="button"
              onClick={() => navigator.clipboard.writeText(publicUrl)}
            >
              Copy {pageWord} link
            </button>
          </div>
        </div>
      )}

      {isLive && (
        <div className="card" style={{ marginBottom: 30 }}>
          <div className="eyebrow">Headstone QR</div>
          <h3 style={{ marginTop: 10 }}>A QR code for the resting place</h3>
          {m.plotId ? (
            <>
              <p className="muted">
                This memorial is linked to a plot. The QR code sits with the plot, so anyone who
                scans it sees everyone remembered at that resting place. A beautiful way to
                honour a family grave.
              </p>
              <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                <Link href={`/plot/${m.plotId}/qr`} className="button">
                  Get QR code (SVG + PNG)
                </Link>
                <Link href={`/plot/${m.plotId}`} className="button secondary">
                  View plot page
                </Link>
                <Link
                  href={`/create?plot=${encodeURIComponent(m.plotId)}`}
                  className="button secondary"
                >
                  Add another memorial to this plot
                </Link>
              </div>
              <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                Additional names on this plot use the reduced rate. The QR is already engraved
                on the stone, so nothing physical needs to change.
              </p>
            </>
          ) : m.cemetery?.placeId ? (
            <>
              <p className="muted">
                Create the plot for {m.fullName.split(' ')[0]}&rsquo;s resting place and we&rsquo;ll
                generate an etchable QR code the stonemason can add to the headstone. The QR links
                to a page listing everyone remembered at that plot, so future family members can
                be added over time without ever changing the code on the stone.
              </p>
              {plotError && (
                <p style={{ color: '#a94442', marginTop: 12, fontSize: 14 }}>{plotError}</p>
              )}
              <button className="button" style={{ marginTop: 16 }} onClick={linkPlot} disabled={linkingPlot}>
                {linkingPlot ? 'Creating plot…' : 'Create plot & get QR code'}
              </button>
            </>
          ) : (
            <>
              <p className="muted">
                To generate a headstone QR, first add the cemetery to the memorial. The plot lives
                at that cemetery, and the QR code links to the plot.
              </p>
              <Link href={`/memorial/${m.id}/edit`} className="button secondary" style={{ marginTop: 16 }}>
                Add cemetery details
              </Link>
            </>
          )}
        </div>
      )}

      {isLive && m.plotId && m.cemetery && auth.currentUser && (
        <PlotLocationEditor
          plotId={m.plotId}
          cemetery={m.cemetery}
          actorUid={auth.currentUser.uid}
          actorEmail={auth.currentUser.email || undefined}
        />
      )}

      {isLive && quotas.totalBytesPerMemorial > 0 && (
        <div className="card" style={{ marginBottom: 30, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Storage</div>
            <p style={{ margin: 0, fontSize: 14 }}>
              {humanBytes(usageBytes)} used of {humanBytes(quotas.totalBytesPerMemorial)}
            </p>
            <div style={{ height: 8, background: '#f0e8d8', borderRadius: 999, marginTop: 8, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(100, Math.round((usageBytes / quotas.totalBytesPerMemorial) * 100))}%`,
                  height: '100%',
                  background: usageBytes / quotas.totalBytesPerMemorial > 0.9 ? '#a05a00' : '#8bab99',
                }}
              />
            </div>
          </div>
          {usageBytes / quotas.totalBytesPerMemorial > 0.85 && (
            <p className="muted" style={{ margin: 0, fontSize: 13, flex: '1 1 260px' }}>
              You&rsquo;re nearing the allowance. Email <a href="mailto:hello@freastar.com">hello@freastar.com</a> and
              we&rsquo;ll happily raise it. No upload will ever fail silently.
            </p>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 30 }}>
        <div className="eyebrow">Looking to the future</div>
        <h3 style={{ marginTop: 10 }}>Nominate someone to look after this memorial</h3>
        <p className="muted">
          A memorial is meant to outlast any one of us. Nominate a trusted family member as a{' '}
          <strong>backup</strong>. Nothing changes today, but if you&rsquo;re ever unable to look
          after the memorial, custody will move to them. You can also{' '}
          <strong>transfer custody now</strong> if you&rsquo;d like someone else to take over.
        </p>

        {(m.successorUids || []).length > 0 && (
          <div style={{ background: '#fffdf9', border: '1px solid var(--line)', borderRadius: 14, padding: '14px 18px', marginTop: 16 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 750, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Currently nominated
            </p>
            <ul className="muted" style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 14 }}>
              {(m.successorUids || []).map((uid: string, i: number) => (
                <li key={uid}>{i === 0 ? 'Primary backup' : `Backup #${i + 1}`}: <code>{uid}</code></li>
              ))}
            </ul>
          </div>
        )}

        {pendingTransfers.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 750, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Pending invitations
            </p>
            {pendingTransfers.map((t) => {
              const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/custody/accept/${t.token}`;
              return (
                <div key={t.id} style={{ marginTop: 10, padding: '12px 16px', border: '1px solid var(--line)', borderRadius: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div>
                      <strong>{t.toEmail}</strong>
                      <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>
                        · {t.nominationType === 'primary' ? 'transfer of custody' : 'backup nomination'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="button secondary small"
                        onClick={() => navigator.clipboard.writeText(link)}
                      >
                        Copy invitation link
                      </button>
                      <button className="button secondary small" onClick={() => cancelNomination(t.id)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                  <p className="muted" style={{ margin: '6px 0 0', fontSize: 12, wordBreak: 'break-all' }}>
                    {link}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 22 }}>
          <label htmlFor="successorEmail">Email of the person you want to nominate</label>
          <input
            id="successorEmail"
            type="email"
            value={successorEmail}
            onChange={(e) => setSuccessorEmail(e.target.value)}
            placeholder="e.g. son@example.com"
          />
          <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}>
              <input
                type="radio"
                name="successorType"
                value="backup"
                checked={successorType === 'backup'}
                onChange={() => setSuccessorType('backup')}
                style={{ width: 'auto' }}
              />
              <span>Nominate as backup (kind default)</span>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}>
              <input
                type="radio"
                name="successorType"
                value="primary"
                checked={successorType === 'primary'}
                onChange={() => setSuccessorType('primary')}
                style={{ width: 'auto' }}
              />
              <span>Transfer custody to them now</span>
            </label>
          </div>

          {nominationError && (
            <p style={{ color: '#a94442', marginTop: 12, fontSize: 14 }}>{nominationError}</p>
          )}

          {nominationLink && (
            <div style={{ marginTop: 16, padding: '14px 18px', background: '#e8f0ea', borderRadius: 12, border: '1px solid #a8bcae' }}>
              <p style={{ margin: 0, fontSize: 14 }}>
                <strong>Invitation ready.</strong> Send this link to the person you nominated.
                Once they sign in with the same email and accept, we&rsquo;ll do the rest.
              </p>
              <p style={{ margin: '8px 0', fontSize: 13, wordBreak: 'break-all' }}>{nominationLink}</p>
              <button
                className="button secondary small"
                onClick={() => navigator.clipboard.writeText(nominationLink)}
              >
                Copy invitation link
              </button>
            </div>
          )}

          <button className="button" style={{ marginTop: 18 }} onClick={nominate} disabled={savingNomination}>
            {savingNomination ? 'Preparing invitation…' : 'Send invitation'}
          </button>
        </div>
      </div>

      {(!m.epitaph || !m.story) && (
        <div
          className="card"
          style={{
            marginBottom: 24,
            background: 'linear-gradient(135deg, #fffdf9, #f6efe1)',
            borderColor: '#e0d3b0',
          }}
        >
          <div className="eyebrow">Finish setting up</div>
          <h3 style={{ marginTop: 10 }}>
            {isLegacy ? 'A few more words to make it yours' : `A few more words about ${firstName}`}
          </h3>
          <p className="muted">
            {isLegacy
              ? "Add a short line for beneath your name and the fuller story when you're ready. Write as little or as much as feels right."
              : `Add a short line for beneath the name and the fuller story when you're ready. Write as little or as much as feels right.`}
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <Link href={`/memorial/${m.id}/edit`} className="button">
              {!m.epitaph && !m.story
                ? isLegacy ? 'Add a line and your story' : 'Add a line and their story'
                : !m.epitaph
                  ? isLegacy ? 'Add a line beneath your name' : 'Add a line beneath the name'
                  : 'Add the story'}
            </Link>
            <Link href={`/memorial/${m.id}/gallery`} className="button secondary">
              Add photographs
            </Link>
          </div>
        </div>
      )}

      {/* Existing management cards */}
      <div className="featureGrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <div className="card">
          <h3>{isLegacy ? 'Edit the details' : 'Edit their story'}</h3>
          <p className="muted">Name, dates, introduction, life story and privacy.</p>
          <Link href={`/memorial/${m.id}/edit`} className="button soft">
            Edit {pageWord}
          </Link>
        </div>
        <div className="card">
          <h3>Photographs</h3>
          <p className="muted">Upload photographs, star up to 4 favourites for the highlighted strip.</p>
          <Link href={`/memorial/${m.id}/gallery`} className="button soft">
            Open gallery
          </Link>
        </div>
        <div className="card">
          <h3>{isLegacy ? 'Your own memories' : 'Family memories'}</h3>
          <p className="muted">
            {isLegacy
              ? 'Write in your own voice. The memories and moments you want carried forward.'
              : `Write your own memories. The family's voice on the memorial.`}
          </p>
          <Link href={`/memorial/${m.id}/memories`} className="button soft">
            Write memories
          </Link>
        </div>
        <div className="card">
          <h3>Invite people</h3>
          <p className="muted">Send the private link to people who knew them.</p>
          <button
            className="button soft"
            disabled={!isLive}
            onClick={() => navigator.clipboard.writeText(publicUrl)}
          >
            {isLive ? `Copy ${pageWord} link` : 'Publish first to share'}
          </button>
        </div>
      </div>

      {isLive && (
        <section style={{ marginTop: 55 }}>
          <div className="eyebrow">Contributions inbox</div>
          <h2>Waiting for you</h2>
          {items.length === 0 ? (
            <div className="card">
              <p className="muted">There are no contributions waiting at the moment.</p>
            </div>
          ) : (
            items.map((c) => {
              const isPrivate = c.audience === 'family_only';
              return (
                <div className="card contribution" key={c.id} style={{ marginBottom: 12 }}>
                  {c.photoPath ? (
                    <ContributionPhoto path={c.photoPath} />
                  ) : (
                    <div className="thumb" />
                  )}
                  <div>
                    <strong>{c.contributorName}</strong>
                    {c.relationship && <span className="muted"> · {c.relationship}</span>}
                    {isPrivate && (
                      <span
                        style={{
                          display: 'inline-block',
                          marginLeft: 10,
                          padding: '3px 10px',
                          borderRadius: 999,
                          background: '#f0e8d8',
                          color: '#8b6f30',
                          fontSize: 11,
                          fontWeight: 750,
                          letterSpacing: '.04em',
                          textTransform: 'uppercase',
                        }}
                      >
                        Private message
                      </span>
                    )}
                    <p>{c.memory || c.caption || 'Photograph submitted'}</p>
                    {isPrivate && (
                      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        The sender asked that this stays with the family only. It won&rsquo;t appear
                        on the memorial.
                      </p>
                    )}
                  </div>
                  <div className="toolbar">
                    {!isPrivate && (
                      <button className="button small" onClick={() => contribStatus(c.id, 'approved')}>
                        Approve for the memorial
                      </button>
                    )}
                    {isPrivate && (
                      <button
                        className="button small"
                        onClick={() => contribStatus(c.id, 'approved')}
                      >
                        Keep in family archive
                      </button>
                    )}
                    {c.photoPath && (
                      <button
                        className="button secondary small"
                        onClick={() => download(c.photoPath, c.caption)}
                      >
                        Download
                      </button>
                    )}
                    <button
                      className="button secondary small"
                      onClick={() => contribStatus(c.id, 'rejected')}
                    >
                      {isPrivate ? 'Delete' : 'Not now'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </section>
      )}
    </main>
  );
}
