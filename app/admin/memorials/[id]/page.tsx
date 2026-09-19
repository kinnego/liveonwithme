'use client';
// Admin memorial inspector — a read-only super_admin view of a single
// memorial and the records around it (owner, plot, contributions, custody
// transfers, referrals, payments, audit trail).
//
// Deliberately read-only. Admin write actions (delete, force publish, etc.)
// live in dedicated flows in the admin console so they get their own audit
// entries and never impersonate the family custodian.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import type {
  AuditEvent,
  Contribution,
  CustodyTransfer,
  Memorial,
  Payment,
  Plot,
  Referral,
  UserProfile,
} from '@/lib/types';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type Access = 'checking' | 'ok' | 'denied';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof (v as any).toDate === 'function') return (v as any).toDate();
  if (v instanceof Date) return v;
  return null;
}

function fmtDate(v: unknown): string {
  const d = toDate(v);
  return d ? d.toLocaleString() : '—';
}

function fmtDay(v?: string): string {
  if (!v) return '—';
  return v;
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtEuros(cents?: number): string {
  if (typeof cents !== 'number') return '—';
  return `€${(cents / 100).toFixed(2)}`;
}

export default function AdminMemorialInspector({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [access, setAccess] = useState<Access>('checking');
  const [id, setId] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [m, setM] = useState<Memorial | null>(null);
  const [owner, setOwner] = useState<UserProfile | null>(null);
  const [successors, setSuccessors] = useState<UserProfile[]>([]);
  const [plot, setPlot] = useState<Plot | null>(null);
  const [referral, setReferral] = useState<Referral | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [contribs, setContribs] = useState<Contribution[]>([]);
  const [transfers, setTransfers] = useState<CustodyTransfer[]>([]);
  const [audits, setAudits] = useState<AuditEvent[]>([]);

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  useEffect(() => {
    if (!id || !auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return;
      const profSnap = await getDoc(doc(db, 'users', u.uid));
      const prof = profSnap.exists() ? (profSnap.data() as UserProfile) : null;
      if (!isSuperAdmin(prof)) {
        setAccess('denied');
        return;
      }
      setAccess('ok');

      const memSnap = await getDoc(doc(db, 'memorials', id));
      if (!memSnap.exists()) {
        setNotFound(true);
        return;
      }
      const mem = { id: memSnap.id, ...(memSnap.data() as any) } as Memorial;
      setM(mem);

      // Owner + successors
      const uidsToLoad = Array.from(
        new Set(
          [mem.ownerId, ...(mem.successorUids || [])].filter(
            (x): x is string => !!x,
          ),
        ),
      );
      const userSnaps = await Promise.all(
        uidsToLoad.map((uid) => getDoc(doc(db, 'users', uid))),
      );
      const usersByUid: Record<string, UserProfile> = {};
      userSnaps.forEach((s, i) => {
        if (s.exists()) usersByUid[uidsToLoad[i]] = s.data() as UserProfile;
      });
      setOwner(usersByUid[mem.ownerId] || null);
      setSuccessors(
        (mem.successorUids || [])
          .map((u) => usersByUid[u])
          .filter((x): x is UserProfile => !!x),
      );

      // Plot
      if (mem.plotId) {
        const ps = await getDoc(doc(db, 'plots', mem.plotId));
        if (ps.exists()) setPlot({ id: ps.id, ...(ps.data() as any) });
      }

      // Referral
      if (mem.referralId) {
        const rs = await getDoc(doc(db, 'referrals', mem.referralId));
        if (rs.exists()) setReferral({ id: rs.id, ...(rs.data() as any) });
      }

      // Related collections (unordered — sorted client-side)
      const [contribSnap, transferSnap, auditSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, 'contributions'), where('memorialId', '==', id))),
        getDocs(query(collection(db, 'custodyTransfers'), where('memorialId', '==', id))),
        getDocs(
          query(
            collection(db, 'auditEvents'),
            where('entityType', '==', 'memorial'),
            where('entityId', '==', id),
          ),
        ),
        getDocs(
          query(collection(db, 'payments'), where('memorialId', '==', id)),
        ).catch(() => null),
      ]);

      setContribs(
        contribSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
      );
      setTransfers(
        transferSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
      );
      setAudits(auditSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      if (paySnap) {
        setPayments(paySnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      }
    });
  }, [id]);

  // Storage totals. `sizeBytes` was added to contribution writes partway
  // through the project's life — older photos, imported demos, and anything
  // written before that migration are on disk but have no size recorded.
  // Report tracked total *and* a count of media items missing size so the
  // number isn't misleading ("0 B" for a page full of photos).
  const storage = useMemo(() => {
    let tracked = 0;
    let untrackedMedia = 0;
    const heroSize = (m as any)?.heroPhotoSize;
    const hasHero = !!(m?.heroPhotoPath || m?.heroPhotoUrl);
    if (typeof heroSize === 'number') tracked += heroSize;
    else if (hasHero) untrackedMedia += 1;
    for (const c of contribs) {
      const hasMedia = !!(c.photoPath || c.photoUrl);
      const b = (c as any).sizeBytes;
      if (typeof b === 'number' && b > 0) tracked += b;
      else if (hasMedia) untrackedMedia += 1;
    }
    return { tracked, untrackedMedia };
  }, [m, contribs]);

  const contribStats = useMemo(() => {
    const s = { pending: 0, approved: 0, rejected: 0 };
    for (const c of contribs) {
      if (c.status in s) (s as any)[c.status] += 1;
    }
    return s;
  }, [contribs]);

  const sortedAudits = useMemo(
    () =>
      [...audits].sort((a, b) => {
        const ta = toDate((a as any).timestamp)?.getTime() ?? 0;
        const tb = toDate((b as any).timestamp)?.getTime() ?? 0;
        return tb - ta;
      }),
    [audits],
  );

  const sortedTransfers = useMemo(
    () =>
      [...transfers].sort((a, b) => {
        const ta = toDate((a as any).invitedAt)?.getTime() ?? 0;
        const tb = toDate((b as any).invitedAt)?.getTime() ?? 0;
        return tb - ta;
      }),
    [transfers],
  );

  const sortedContribs = useMemo(
    () =>
      [...contribs].sort((a, b) => {
        const ta = toDate((a as any).createdAt)?.getTime() ?? 0;
        const tb = toDate((b as any).createdAt)?.getTime() ?? 0;
        return tb - ta;
      }),
    [contribs],
  );

  if (access === 'checking') {
    return <PageSkeleton variant="detail" label="Checking access" />;
  }
  if (access === 'denied') {
    return (
      <main className="shell">
        <div className="card">This area is for site administrators.</div>
      </main>
    );
  }
  if (notFound) {
    return (
      <main className="shell">
        <div className="dashboardHead">
          <div>
            <div className="eyebrow">Admin · memorial</div>
            <h2 style={{ marginBottom: 0 }}>Not found</h2>
          </div>
          <Link href="/admin/memorials" className="button secondary">
            Back to memorials
          </Link>
        </div>
        <div className="card">
          <p className="muted">No memorial with id <code>{id}</code>.</p>
        </div>
      </main>
    );
  }
  if (!m) return <PageSkeleton variant="detail" label="Loading memorial" />;

  const heroUrl = m.heroPhotoUrl
    ? m.heroPhotoUrl
    : m.heroPhotoPath
      ? `${R2_PUBLIC_URL}/${m.heroPhotoPath}`
      : '';

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Admin · memorial</div>
          <h2 style={{ marginBottom: 0 }}>{m.fullName}</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            <code>{m.id}</code> · slug <code>{m.slug}</code>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href={`/m/${m.slug}`} target="_blank" rel="noopener" className="button secondary">
            View public page ↗
          </Link>
          <Link href="/admin/memorials" className="button secondary">
            Back to list
          </Link>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
        Read-only admin view. To act on this memorial (contact the family,
        resolve a payment, etc.), use the dedicated admin console tools —
        actions taken here would be attributed to your account, not the
        custodian&rsquo;s.
      </p>

      {/* Overview */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="eyebrow">Overview</div>
        <div className="twoCol" style={{ marginTop: 10 }}>
          <div>
            <FieldRow label="Kind" value={m.kind || 'memorial'} />
            <FieldRow label="Status" value={m.status} />
            <FieldRow label="Visibility" value={m.visibility} />
            <FieldRow label="Payment" value={m.paymentStatus} />
            <FieldRow label="Sales channel" value={m.salesChannel} />
            <FieldRow label="Partner UID" value={m.partnerUid || '—'} mono />
            <FieldRow label="Referral" value={m.referralId || '—'} mono />
          </div>
          <div>
            <FieldRow label="Born" value={fmtDay(m.born)} />
            <FieldRow label="Died" value={fmtDay(m.died)} />
            <FieldRow label="Age at death" value={m.ageAtDeath ?? '—'} />
            <FieldRow label="Created" value={fmtDate(m.createdAt)} />
            <FieldRow label="Updated" value={fmtDate(m.updatedAt)} />
            <FieldRow label="Published" value={fmtDate(m.publishedAt)} />
            <FieldRow
              label="Storage in use"
              value={
                storage.untrackedMedia > 0 ? (
                  <>
                    {fmtBytes(storage.tracked)}
                    <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>
                      + {storage.untrackedMedia} item{storage.untrackedMedia === 1 ? '' : 's'} of unknown size
                    </span>
                  </>
                ) : (
                  fmtBytes(storage.tracked)
                )
              }
            />
          </div>
        </div>
        {heroUrl && (
          <div style={{ marginTop: 18 }}>
            <span className="fieldLabel">Hero photograph</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroUrl}
              alt=""
              style={{
                width: 180,
                height: 180,
                objectFit: 'cover',
                borderRadius: 12,
                border: '1px solid var(--line)',
                marginTop: 6,
              }}
            />
          </div>
        )}
        {m.epitaph && (
          <div style={{ marginTop: 16 }}>
            <span className="fieldLabel">Epitaph</span>
            <p style={{ marginTop: 4, marginBottom: 0 }}>{m.epitaph}</p>
          </div>
        )}
        {m.story && (
          <div style={{ marginTop: 16 }}>
            <span className="fieldLabel">Story</span>
            <p style={{ marginTop: 4, marginBottom: 0, whiteSpace: 'pre-wrap' }}>
              {m.story}
            </p>
          </div>
        )}
      </div>

      {/* Ownership */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="eyebrow">Ownership</div>
        <FieldRow label="Owner UID" value={m.ownerId} mono />
        <FieldRow label="Owner email" value={owner?.email || '—'} />
        <FieldRow label="Owner name" value={owner?.displayName || '—'} />
        <FieldRow label="Owner role" value={owner?.role || '—'} />
        {successors.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <span className="fieldLabel">Successors (in order)</span>
            <ol style={{ marginTop: 6, paddingLeft: 22 }}>
              {successors.map((u) => (
                <li key={u.uid} style={{ marginBottom: 4 }}>
                  <strong>{u.displayName || '—'}</strong> · {u.email} · <code>{u.uid}</code>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Location */}
      {(m.cemetery || plot) && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="eyebrow">Location</div>
          {m.cemetery && (
            <>
              <FieldRow label="Cemetery" value={m.cemetery.name} />
              <FieldRow label="Address" value={m.cemetery.address} />
              <FieldRow label="Place ID" value={m.cemetery.placeId} mono />
              <FieldRow
                label="Coords"
                value={
                  m.cemetery.lat != null && m.cemetery.lng != null
                    ? `${m.cemetery.lat}, ${m.cemetery.lng}`
                    : '—'
                }
              />
            </>
          )}
          {plot && (
            <div style={{ marginTop: 12 }}>
              <FieldRow label="Plot ID" value={plot.id} mono />
              <FieldRow label="Plot name" value={plot.name || '—'} />
              <FieldRow label="Plot short id" value={plot.shortId} mono />
              <FieldRow label="Plot admin" value={plot.plotAdminUid} mono />
              <Link
                href={`/plot/${plot.id}`}
                target="_blank"
                rel="noopener"
                style={{ color: 'var(--sage)', fontSize: 14 }}
              >
                Open plot page ↗
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Referral / payments */}
      {(referral || payments.length > 0) && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="eyebrow">Commerce</div>
          {referral && (
            <div style={{ marginTop: 6 }}>
              <FieldRow label="Referral ID" value={referral.id} mono />
              <FieldRow label="Partner UID" value={referral.partnerUid} mono />
              <FieldRow label="Bereaved" value={`${referral.bereavedName} · ${referral.bereavedEmail}`} />
              <FieldRow label="Wholesale" value={`${referral.wholesalePaymentStatus} · ${fmtEuros(referral.wholesaleAmountCents)}`} />
              <FieldRow label="Referral status" value={referral.status} />
            </div>
          )}
          {payments.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <span className="fieldLabel">Payments</span>
              <ul style={{ marginTop: 6, paddingLeft: 22 }}>
                {payments.map((p) => (
                  <li key={p.id} style={{ marginBottom: 4 }}>
                    {p.kind} · {p.status} · {fmtEuros(p.amount)} {p.currency?.toUpperCase()} · {fmtDate(p.paidAt || p.createdAt)}
                    <div className="muted" style={{ fontSize: 12 }}>
                      <code>{p.providerPaymentId}</code>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Contributions */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="eyebrow">Contributions</div>
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          {contribStats.approved} approved · {contribStats.pending} pending · {contribStats.rejected} rejected
        </p>
        {sortedContribs.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>No contributions yet.</p>
        ) : (
          <div style={{ overflow: 'auto', marginTop: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
              <thead>
                <tr style={{ background: '#fffdf9', borderBottom: '1px solid var(--line)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Contributor</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Kind</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Audience</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Added</th>
                </tr>
              </thead>
              <tbody>
                {sortedContribs.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 12px' }}>
                      <div>{c.contributorName}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {c.relationship || '—'}
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {c.mediaType || (c.photoPath || c.photoUrl ? 'photo' : c.memory ? 'text' : '—')}
                    </td>
                    <td style={{ padding: '8px 12px' }}>{c.status}</td>
                    <td style={{ padding: '8px 12px' }}>{c.audience || '—'}</td>
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Custody */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="eyebrow">Custody transfers</div>
        {sortedTransfers.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>No custody transfers.</p>
        ) : (
          <ul style={{ marginTop: 10, paddingLeft: 20 }}>
            {sortedTransfers.map((t) => (
              <li key={t.id} style={{ marginBottom: 8 }}>
                <strong>{t.nominationType}</strong> · <strong>{t.status}</strong>
                <br />
                <span className="muted" style={{ fontSize: 13 }}>
                  From <code>{t.fromUid}</code> to <code>{t.toEmail}</code>
                  {t.toUidWhenAccepted && (
                    <> · accepted as <code>{t.toUidWhenAccepted}</code></>
                  )}
                  <br />
                  Invited {fmtDate(t.invitedAt)}
                  {t.respondedAt ? <> · responded {fmtDate(t.respondedAt)}</> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Audit */}
      <div className="card" style={{ marginTop: 20, marginBottom: 40 }}>
        <div className="eyebrow">Audit log</div>
        {sortedAudits.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>No audit entries.</p>
        ) : (
          <ul style={{ marginTop: 10, paddingLeft: 20 }}>
            {sortedAudits.map((a) => (
              <li key={a.id} style={{ marginBottom: 8 }}>
                <strong>{a.action}</strong>
                <br />
                <span className="muted" style={{ fontSize: 13 }}>
                  {fmtDate((a as any).timestamp)} · by{' '}
                  {a.actorEmail || <code>{a.actorUid}</code>}
                  {a.details && Object.keys(a.details).length > 0 && (
                    <> · <code style={{ fontSize: 12 }}>{JSON.stringify(a.details)}</code></>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function FieldRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '4px 0', fontSize: 14 }}>
      <span className="muted" style={{ minWidth: 140 }}>{label}</span>
      <span style={mono ? { fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13 } : undefined}>
        {value}
      </span>
    </div>
  );
}
