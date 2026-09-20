'use client';
import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import CemeterySearch from '@/components/CemeterySearch';
import CemeteryMap from '@/components/CemeteryMap';
import {
  customIdFromPlaceId,
  isCustomPlaceId,
  readCustomCemetery,
  submitCemeteryReport,
  updateCustomCemeteryName,
} from '@/lib/cemeteries';
import type { CustomCemetery } from '@/lib/types';

export const dynamic = 'force-dynamic';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

type Memorial = {
  id: string;
  slug: string;
  fullName: string;
  born?: string;
  died?: string;
  heroPhotoPath?: string;
  cemetery?: { name?: string; address?: string; placeId?: string };
};

export default function CemeteryPage({
  params,
  searchParams,
}: {
  params: Promise<{ placeId: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const { placeId } = use(params);
  const sp = use(searchParams);
  const isCustom = isCustomPlaceId(placeId);
  const [memorials, setMemorials] = useState<Memorial[] | null>(null);
  const [custom, setCustom] = useState<CustomCemetery | null>(null);
  const [customError, setCustomError] = useState('');
  const [error, setError] = useState('');
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);

  useEffect(() => {
    if (!isCustom) return;
    (async () => {
      try {
        const c = await readCustomCemetery(customIdFromPlaceId(placeId));
        if (!c) {
          setCustomError('We couldn\u2019t find that cemetery.');
          return;
        }
        setCustom(c);
      } catch (err: any) {
        console.error('readCustomCemetery failed:', err);
        setCustomError(err?.message || 'Something went wrong.');
      }
    })();
  }, [isCustom, placeId]);

  useEffect(() => {
    (async () => {
      try {
        if (!db) throw new Error('Firestore not available');
        const snap = await getDocs(
          query(
            collection(db, 'memorials'),
            where('cemetery.placeId', '==', placeId),
            where('status', '==', 'live'),
            where('visibility', '==', 'public')
          )
        );
        setMemorials(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Memorial)));
      } catch (err: any) {
        console.error('Cemetery query failed:', err);
        setError(
          err?.code === 'failed-precondition'
            ? 'Search is warming up — please try again in a moment.'
            : 'Something went wrong loading this cemetery.'
        );
        setMemorials([]);
      }
    })();
  }, [placeId]);

  const first = memorials?.[0]?.cemetery as
    | { name?: string; address?: string; placeId?: string; lat?: number | null; lng?: number | null }
    | undefined;
  const cemeteryName =
    custom?.name || first?.name || sp.name || 'This cemetery';
  const cemeteryAddress = custom?.address || first?.address;
  const cemeteryLat =
    typeof custom?.lat === 'number'
      ? custom.lat
      : typeof first?.lat === 'number'
        ? first.lat
        : null;
  const cemeteryLng =
    typeof custom?.lng === 'number'
      ? custom.lng
      : typeof first?.lng === 'number'
        ? first.lng
        : null;

  return (
    <main className="shell">
      <div className="eyebrow">Find someone</div>
      <h1 style={{ marginBottom: 8 }}>{cemeteryName}</h1>
      {cemeteryAddress && (
        <p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>
          {cemeteryAddress}
        </p>
      )}

      {isCustom && custom && (
        <CommunityBadge custom={custom} user={user} onRenamed={(c) => setCustom(c)} />
      )}
      {isCustom && customError && (
        <div className="card" style={{ marginBottom: 20 }}>
          <p className="muted" style={{ margin: 0 }}>{customError}</p>
        </div>
      )}
      {isCustom && custom && (
        <ReportBlock cemeteryId={custom.id} user={user} />
      )}

      <CemeteryMap
        placeId={placeId}
        name={cemeteryName}
        lat={cemeteryLat}
        lng={cemeteryLng}
      />

      <div style={{ maxWidth: 520, marginBottom: 40 }}>
        <label className="fieldLabel" htmlFor="cemetery-search">
          Search a different cemetery
        </label>
        <CemeterySearch />
      </div>

      {memorials === null && <p className="muted">Looking for memorials…</p>}

      {error && (
        <div className="card" style={{ marginBottom: 20 }}>
          <p className="muted" style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      {memorials && memorials.length === 0 && !error && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>No public memorials listed here yet</h3>
          <p className="muted">
            When families choose to make their loved one&rsquo;s memorial public and link it to
            this cemetery, it will appear here.
          </p>
        </div>
      )}

      {memorials && memorials.length > 0 && (
        <>
          <p className="muted" style={{ marginBottom: 18 }}>
            {memorials.length} memorial{memorials.length === 1 ? '' : 's'} at this cemetery
          </p>
          <div className="cemeteryList">
            {memorials.map((m) => {
              const years = `${m.born?.slice(0, 4) || ''} — ${m.died?.slice(0, 4) || ''}`;
              const hero = m.heroPhotoPath ? `${R2_PUBLIC_URL}/${m.heroPhotoPath}` : '';
              return (
                <Link
                  key={m.id}
                  href={`/m/${m.slug}`}
                  className="cemeteryCard"
                  style={{ display: 'block' }}
                >
                  <div
                    className="cemeteryHero"
                    style={
                      hero
                        ? {
                            backgroundImage: `linear-gradient(rgba(22,30,27,.08),rgba(22,30,27,.4)),url(${hero})`,
                          }
                        : {}
                    }
                  />
                  <div style={{ padding: '18px 20px' }}>
                    <h3 style={{ margin: 0, fontSize: 22 }}>{m.fullName}</h3>
                    <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
                      {years}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <p className="muted" style={{ marginTop: 60, fontSize: 13, textAlign: 'center' }}>
        Only memorials that families have chosen to make public appear here.
      </p>
    </main>
  );
}

// Small card that appears above the map for community-added cemeteries.
// Any signed-in user can correct the name — the location itself is locked so
// nobody can move a plot out from under a family who already used the entry.
function CommunityBadge({
  custom,
  user,
  onRenamed,
}: {
  custom: CustomCemetery;
  user: User | null;
  onRenamed: (c: CustomCemetery) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(custom.name);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setErr('Name cannot be empty.');
      return;
    }
    if (trimmed === custom.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setErr('');
    try {
      await updateCustomCemeteryName(custom.id, trimmed, user.uid);
      onRenamed({ ...custom, name: trimmed, nameLower: trimmed.toLowerCase() });
      setEditing(false);
    } catch (e: any) {
      setErr(e?.message || 'Rename failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="card"
      style={{
        marginBottom: 20,
        background: '#f7f4ee',
        borderColor: '#e0d8c8',
        padding: '14px 18px',
      }}
    >
      {!editing ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <p style={{ margin: 0, fontSize: 14 }}>
            <strong>Community-added cemetery.</strong>{' '}
            <span className="muted">
              If the name isn&rsquo;t quite right, anyone signed in can improve it.
            </span>
          </p>
          {user ? (
            <button
              type="button"
              className="button secondary small"
              onClick={() => setEditing(true)}
            >
              Correct the name
            </button>
          ) : (
            <Link href={`/auth?next=/cemetery/c-${custom.id}`} className="button secondary small">
              Sign in to correct
            </Link>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Cemetery name"
            style={{ flex: '1 1 220px' }}
          />
          <button
            type="button"
            className="button small"
            disabled={saving}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={saving}
            onClick={() => {
              setName(custom.name);
              setEditing(false);
              setErr('');
            }}
          >
            Cancel
          </button>
          {err && (
            <p style={{ color: '#a94442', fontSize: 13, margin: 0, width: '100%' }}>{err}</p>
          )}
        </div>
      )}
    </div>
  );
}

// Lightweight report affordance shown under the community-added notice. Anyone
// can file a report — the write is public but the doc is admin-only. Bad
// listings get pulled by a super admin from /admin/cemeteries.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ReportBlock({
  cemeteryId,
  user,
}: {
  cemeteryId: string;
  user: User | null;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  async function submit() {
    if (!reason.trim()) {
      setErr('Please tell us what\u2019s wrong.');
      return;
    }
    if (!user && !EMAIL_RE.test(email.trim())) {
      setErr('Please leave an email so we can follow up.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      await submitCemeteryReport({
        cemeteryId,
        reason: reason.trim(),
        reporterEmail: user ? user.email || undefined : email.trim(),
        reporterUid: user?.uid,
      });
      setDone(true);
    } catch (e: any) {
      setErr(e?.message || 'Could not send the report. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
        Thank you — a member of our team will review this listing.
      </p>
    );
  }

  if (!open) {
    return (
      <p style={{ fontSize: 13, marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--muted)',
            textDecoration: 'underline',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Report this listing
        </button>
      </p>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 20, padding: '14px 18px' }}>
      <div className="fieldLabel" style={{ marginTop: 0 }}>What&rsquo;s wrong with this listing?</div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. This is a duplicate of St. Colman's Cemetery, or the pin is in the wrong place."
        style={{ minHeight: 80 }}
      />
      {!user && (
        <>
          <label htmlFor="reportEmail">Your email</label>
          <input
            id="reportEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Not shown publicly — only used to reach you if we need details.
          </p>
        </>
      )}
      {err && (
        <p style={{ color: '#a94442', fontSize: 13, margin: '10px 0 0' }}>{err}</p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="button small" onClick={submit} disabled={saving}>
          {saving ? 'Sending…' : 'Send report'}
        </button>
        <button
          type="button"
          className="button secondary small"
          onClick={() => {
            setOpen(false);
            setErr('');
          }}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
