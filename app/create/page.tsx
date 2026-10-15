'use client';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useRouter, useSearchParams } from 'next/navigation';
import { calculateAgeAtDeath } from '@/lib/age';
import { resizeForMobile } from '@/lib/image';
import { createPerson } from '@/lib/person';
import { slugify } from '@/lib/ids';
import { writeAudit } from '@/lib/audit';
import { attachMemorialToExistingPlot, isPlotAdmin } from '@/lib/plot';
import { isApprovedPartner } from '@/lib/roles';
import type { MemorialKind, Plot, UserProfile } from '@/lib/types';
import { PageSkeleton } from '@/components/Skeleton';

// A plot the current user administers plus the names of memorials already
// resting on it. Used to drive the "Is this person buried with someone
// you've already set up a page for?" prompt — the biggest discoverability
// gap in the current flow is that there was no path from "/create" to
// "attach to an existing plot" without going through the first memorial's
// manage page.
interface OwnedPlotOption {
  plot: Plot;
  memorialNames: string[];
}

export const dynamic = 'force-dynamic';

// useSearchParams() forces a Suspense boundary during production builds,
// otherwise Next.js fails prerender with a CSR-bailout error.
export default function Create() {
  return (
    <Suspense fallback={<PageSkeleton variant="form" label="Loading" />}>
      <CreateInner />
    </Suspense>
  );
}

type Copy = {
  eyebrow: string;
  heading: string;
  intro: string;
  nameLabel: string;
  namePlaceholder: string;
  submitLabel: string;
};

const COPY: Record<MemorialKind, Copy> = {
  memorial: {
    eyebrow: 'A memorial for someone I love',
    heading: 'Tell us about them.',
    intro: "Just the essentials for now. You can add photographs, a story and much more once the page is created.",
    nameLabel: 'Their full name',
    namePlaceholder: "Mary O'Donnell",
    submitLabel: 'Create memorial',
  },
  legacy: {
    eyebrow: 'A page from me, for those I love',
    heading: 'Tell us about you.',
    intro:
      "Just the essentials for now. You'll be able to add your story, photographs and everything else once the page is created.",
    nameLabel: 'Your full name',
    namePlaceholder: 'Mary O’Donnell',
    submitLabel: 'Create my page',
  },
};

function CreateInner() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [mode, setMode] = useState<MemorialKind | null>(null);
  // null = not yet known; false = signed-out or confirmed non-partner.
  // We hide the mode picker from approved partners because their flow is
  // always setting up a page for a family they're helping — a personal
  // legacy page doesn't fit that context and tends to confuse the picker.
  const [isPartner, setIsPartner] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  // If arriving with ?plot=[plotId], we're adding a second/third memorial
  // to an existing plot. Cemetery + plot linkage are inherited from the plot
  // so the user never has to re-enter them, and the go-live price is the
  // secondary rate.
  const [presetPlot, setPresetPlot] = useState<Plot | null>(null);
  const [presetPlotError, setPresetPlotError] = useState('');
  // Plots the signed-in user administers, discovered lazily once they pick
  // memorial mode and we don't already have a `?plot=` preset. `null` means
  // "not yet queried"; empty array means "queried, nothing to show".
  const [ownerPlots, setOwnerPlots] = useState<OwnedPlotOption[] | null>(null);
  const [plotStepSkipped, setPlotStepSkipped] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetPlotId = searchParams?.get('plot') || '';

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  useEffect(() => {
    if (!user) {
      setIsPartner(user === null ? false : null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const prof = snap.exists() ? (snap.data() as UserProfile) : null;
        if (!cancelled) setIsPartner(isApprovedPartner(prof));
      } catch {
        if (!cancelled) setIsPartner(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    try {
      const raw = window.localStorage.getItem('createDraft');
      if (raw) setDraft(JSON.parse(raw));
      const savedMode = window.localStorage.getItem('createMode') as MemorialKind | null;
      if (savedMode === 'memorial' || savedMode === 'legacy') setMode(savedMode);
    } catch {}
  }, [user]);

  useEffect(() => {
    // Force memorial mode as soon as we know we're attaching to a plot — a
    // legacy (pre-death) page isn't a physical resting place.
    if (presetPlotId) setMode('memorial');
  }, [presetPlotId]);

  useEffect(() => {
    // Partners never see the picker — they're setting up pages for families
    // they're helping, not writing a legacy page for themselves.
    if (isPartner) setMode('memorial');
  }, [isPartner]);

  useEffect(() => {
    if (!user || !presetPlotId || !db) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'plots', presetPlotId));
        if (!snap.exists()) {
          setPresetPlotError('That plot could not be found.');
          return;
        }
        const p = { id: snap.id, ...(snap.data() as any) } as Plot;
        if (!isPlotAdmin(p, user.uid)) {
          setPresetPlotError('Only the plot administrator can add memorials to this plot.');
          return;
        }
        setPresetPlot(p);
      } catch (err: any) {
        setPresetPlotError(err?.message || 'Could not load that plot.');
      }
    })();
  }, [user, presetPlotId]);

  // Discover plots the user already administers so we can offer "is this
  // person resting with someone you've already set up?" before they re-enter
  // the cemetery. Only runs on the memorial path (legacy pages have no
  // physical resting place), and only when we don't have a specific plot in
  // the URL already. Legacy single-admin plot docs (plotAdminUid, not
  // plotAdminUids) aren't returned by this array-contains query — those are
  // old enough to be rare and the user can still add via the manage page.
  useEffect(() => {
    if (!user || !db) return;
    if (mode !== 'memorial') return;
    if (presetPlotId) return;
    if (plotStepSkipped) return;
    if (ownerPlots !== null) return;

    let cancelled = false;
    (async () => {
      try {
        const plotsSnap = await getDocs(
          query(
            collection(db, 'plots'),
            where('plotAdminUids', 'array-contains', user.uid),
          ),
        );
        if (cancelled) return;

        const results: OwnedPlotOption[] = [];
        for (const plotDoc of plotsSnap.docs) {
          const plot = { id: plotDoc.id, ...(plotDoc.data() as any) } as Plot;
          const memberSnap = await getDocs(
            query(
              collection(db, 'plotMemberships'),
              where('plotId', '==', plot.id),
              where('status', '==', 'approved'),
            ),
          );
          if (cancelled) return;

          const names: string[] = [];
          for (const memDoc of memberSnap.docs) {
            const memId = memDoc.data().memorialId as string | undefined;
            if (!memId) continue;
            try {
              const memSnap = await getDoc(doc(db, 'memorials', memId));
              if (!memSnap.exists()) continue;
              const name = (memSnap.data() as any)?.fullName;
              if (typeof name === 'string' && name) names.push(name);
            } catch {
              // Memorial may not be readable (e.g. private draft owned by
              // someone else) — skip without failing the whole discovery.
            }
          }
          results.push({ plot, memorialNames: names });
        }
        if (!cancelled) setOwnerPlots(results);
      } catch (err) {
        console.warn('could not load owner plots', err);
        if (!cancelled) setOwnerPlots([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, mode, presetPlotId, plotStepSkipped, ownerPlots]);

  function persistDraft(next: Record<string, string>) {
    setDraft(next);
    try {
      window.localStorage.setItem('createDraft', JSON.stringify(next));
    } catch {}
  }

  function chooseMode(next: MemorialKind) {
    try {
      window.localStorage.setItem('createMode', next);
    } catch {}
    if (!user) {
      const nextPath = presetPlotId
        ? `/create?plot=${encodeURIComponent(presetPlotId)}`
        : '/create';
      router.push(`/auth?next=${encodeURIComponent(nextPath)}`);
      return;
    }
    setMode(next);
  }

  async function uploadToR2(file: File, kind: 'memorial-hero' | 'memorial-gallery' | 'memorial-memory', memorialId: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('kind', kind);
    formData.append('memorialId', memorialId);
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data as { path: string; sizeBytes: number };
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (!auth.currentUser || !mode) return;
    setSaving(true);
    setProgress(mode === 'legacy' ? 'Setting up your page…' : "Setting up their page…");
    try {
      const fd = new FormData(e.currentTarget);
      const fullName = String(fd.get('fullName')).trim();
      const slug = `${slugify(fullName)}-${Math.random().toString(36).slice(2, 7)}`;
      const memorialRef = doc(db, 'memorials', slug);

      const born = String(fd.get('born') || '');
      const died = mode === 'legacy' ? '' : String(fd.get('died') || '');

      const personId = await createPerson({
        fullName,
        born: born || undefined,
        died: died || undefined,
        isLiving: mode === 'legacy' || !died,
        createdByUid: auth.currentUser.uid,
      });

      await setDoc(memorialRef, {
        ownerId: auth.currentUser.uid,
        createdByUid: auth.currentUser.uid,
        personId,
        plotId: null,
        successorUids: [],
        slug,
        fullName,
        fullNameLower: fullName.toLowerCase(),
        kind: mode,
        born,
        died,
        ageAtDeath: died ? calculateAgeAtDeath(born, died) : null,
        cemetery: presetPlot?.cemetery ?? null,
        featuredContributionIds: [],
        epitaph: '',
        story: '',
        visibility: 'public',
        heroPhotoPath: '',
        status: 'draft',
        paymentStatus: 'unpaid',
        salesChannel: 'direct',
        partnerUid: null,
        referralId: null,
        publishedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (presetPlot) {
        setProgress('Adding to the plot…');
        await attachMemorialToExistingPlot({
          memorialId: slug,
          personId,
          plotId: presetPlot.id,
          requestedByUid: auth.currentUser.uid,
        });
      }

      const photo = fd.get('photo') as File;
      if (photo?.size) {
        setProgress('Adding the photograph…');
        const optimised = await resizeForMobile(photo);
        const uploaded = await uploadToR2(optimised, 'memorial-hero', slug);
        await updateDoc(memorialRef, {
          heroPhotoPath: uploaded.path,
          heroPhotoSize: uploaded.sizeBytes,
          updatedAt: serverTimestamp(),
        });
      }

      await writeAudit({
        entityType: 'memorial',
        entityId: slug,
        action: 'created',
        actorUid: auth.currentUser.uid,
        actorEmail: auth.currentUser.email || undefined,
        details: { kind: mode, hasCemetery: false },
      });

      try {
        window.localStorage.removeItem('createDraft');
        window.localStorage.removeItem('createMode');
      } catch {}

      // Fire-and-forget welcome email. The server route no-ops on second+
      // memorials via users/{uid}.welcomeSentAt, so we don't need to gate
      // the call here. Awaiting would delay the redirect for no gain.
      try {
        const token = await auth.currentUser.getIdToken();
        void fetch('/api/memorial/welcome', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ memorialId: slug }),
        }).catch(() => {});
      } catch {}

      router.push(`/memorial/${slug}/manage`);
    } catch (err: any) {
      console.error('create failed', err);
      setError(
        err?.message ||
          "We couldn't create the page. Your details are saved on this device — please try again in a moment."
      );
      setSaving(false);
    }
  }

  // Waiting for auth state to resolve.
  if (user === undefined) {
    return <PageSkeleton variant="default" label="Loading" />;
  }

  // Wait for partner status before showing the picker, so a partner never
  // sees a flash of the "legacy page" option before it gets hidden.
  if (user && isPartner === null && !mode) {
    return <PageSkeleton variant="default" label="Loading" />;
  }

  // Mode picker — the first choice, mobile-first, full width.
  if (!mode) {
    return (
      <main className="shell">
        <div style={{ maxWidth: 880, margin: '0 auto', textAlign: 'center' }}>
          <div className="eyebrow">Create a page</div>
          <h2 style={{ marginBottom: 10 }}>Who is this page for?</h2>
          <p className="muted" style={{ maxWidth: 560, margin: '0 auto 36px' }}>
            Both kinds of page work the same way — this just helps us use the right words with you.
          </p>

          <div className="pickerGrid">
            <button
              type="button"
              className="pickerTile"
              onClick={() => chooseMode('memorial')}
              aria-label="Create a memorial for someone who has passed"
            >
              <div className="pickerIcon" aria-hidden>♡</div>
              <div className="pickerEyebrow">A memorial</div>
              <div className="pickerTitle">For someone I love who has passed</div>
              <p className="pickerBody">
                A gentle place to gather their photographs and the stories that made them who they were — one that friends and family can add to.
              </p>
              <span className="pickerCta">Start a memorial →</span>
            </button>

            <button
              type="button"
              className="pickerTile"
              onClick={() => chooseMode('legacy')}
              aria-label="Create a legacy page for yourself"
            >
              <div className="pickerIcon" aria-hidden>❋</div>
              <div className="pickerEyebrow">A legacy page</div>
              <div className="pickerTitle">For me, in my own words</div>
              <p className="pickerBody">
                Write it now while you can — your story, your photographs, what you want remembered. Keep it private, share it with family, or leave it quietly for when it&rsquo;s needed.
              </p>
              <span className="pickerCta">Start a legacy page →</span>
            </button>
          </div>

          <p className="muted" style={{ fontSize: 13, marginTop: 30 }}>
            {user
              ? 'Signed in as ' + (user.email || 'you') + ' — you can change your mind at any point.'
              : "You'll create a free account on the next step so nothing gets lost. Already have one? You can sign in there too."}
          </p>
        </div>

        <style jsx>{`
          .pickerGrid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
          }
          .pickerTile {
            background: var(--paper);
            border: 1px solid var(--line);
            border-radius: 22px;
            padding: 34px 28px;
            text-align: left;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            gap: 10px;
            box-shadow: 0 8px 28px rgba(47, 57, 51, 0.04);
            transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
            font: inherit;
            color: inherit;
            min-height: 300px;
          }
          .pickerTile:hover,
          .pickerTile:focus-visible {
            transform: translateY(-3px);
            box-shadow: 0 18px 44px rgba(47, 57, 51, 0.09);
            border-color: #bcc9c2;
            outline: none;
          }
          .pickerIcon {
            width: 54px;
            height: 54px;
            border-radius: 50%;
            background: var(--sage2);
            display: grid;
            place-items: center;
            font-size: 24px;
            color: #2f5b48;
            margin-bottom: 8px;
          }
          .pickerEyebrow {
            letter-spacing: 0.16em;
            text-transform: uppercase;
            font-size: 12px;
            font-weight: 800;
            color: var(--sage);
          }
          .pickerTitle {
            font-family: Georgia, serif;
            font-size: 26px;
            line-height: 1.15;
            color: var(--ink);
          }
          .pickerBody {
            color: var(--muted);
            margin: 6px 0 4px;
            font-size: 15px;
            line-height: 1.55;
          }
          .pickerCta {
            margin-top: auto;
            font-weight: 700;
            color: var(--sage);
          }
          @media (max-width: 720px) {
            .pickerGrid {
              grid-template-columns: 1fr;
              gap: 16px;
            }
            .pickerTile {
              min-height: 0;
              padding: 26px 22px;
            }
            .pickerTitle {
              font-size: 24px;
            }
          }
        `}</style>
      </main>
    );
  }

  // Shared-plot discovery: on the memorial path, if the user administers at
  // least one plot and hasn't been sent to a specific plot via `?plot=`,
  // offer to attach this new memorial to one of them. Keeps the plot's
  // existing QR code (already engraved on the stone) in play and uses the
  // secondary-memorial price at Go Live.
  const askingSharedPlot =
    mode === 'memorial' && !presetPlotId && !plotStepSkipped && !!user;

  if (askingSharedPlot && ownerPlots === null) {
    return <PageSkeleton variant="default" label="Looking for resting places" />;
  }

  if (askingSharedPlot && ownerPlots && ownerPlots.length > 0) {
    return (
      <main className="shell">
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div className="eyebrow">A memorial</div>
          <h2 style={{ marginBottom: 10 }}>Is this person resting with someone already on LiveOnWith.me?</h2>
          <p className="muted" style={{ maxWidth: 580 }}>
            If they share a plot with a memorial you&rsquo;ve already set up, we&rsquo;ll keep the stone&rsquo;s QR code the same and simply add this new name to it.
          </p>

          <div style={{ display: 'grid', gap: 14, marginTop: 24 }}>
            {ownerPlots.map(({ plot, memorialNames }) => (
              <button
                type="button"
                key={plot.id}
                className="plotTile"
                onClick={() =>
                  router.push(`/create?plot=${encodeURIComponent(plot.id)}`)
                }
              >
                <div style={{ fontWeight: 700, fontSize: 17 }}>
                  {plot.name || plot.cemetery?.name || 'Resting place'}
                </div>
                {plot.name && plot.cemetery?.name && (
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                    {plot.cemetery.name}
                  </div>
                )}
                {plot.cemetery?.address && (
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                    {plot.cemetery.address}
                  </div>
                )}
                {memorialNames.length > 0 && (
                  <div style={{ fontSize: 14, marginTop: 12 }}>
                    Already here: {memorialNames.slice(0, 3).join(', ')}
                    {memorialNames.length > 3
                      ? `, and ${memorialNames.length - 3} more`
                      : ''}
                  </div>
                )}
                <div
                  style={{
                    color: 'var(--sage)',
                    fontWeight: 700,
                    fontSize: 14,
                    marginTop: 12,
                  }}
                >
                  Add this memorial here →
                </div>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setPlotStepSkipped(true)}
            style={{
              display: 'block',
              margin: '28px auto 0',
              background: 'none',
              border: 'none',
              color: 'var(--sage)',
              textDecoration: 'underline',
              cursor: 'pointer',
              fontSize: 15,
              padding: 6,
            }}
          >
            No, this is a different resting place
          </button>
        </div>

        <style jsx>{`
          .plotTile {
            background: var(--paper);
            border: 1px solid var(--line);
            border-radius: 18px;
            padding: 20px 22px;
            text-align: left;
            cursor: pointer;
            display: block;
            width: 100%;
            font: inherit;
            color: inherit;
            box-shadow: 0 6px 20px rgba(47, 57, 51, 0.04);
            transition: transform 0.18s ease, border-color 0.18s ease,
              box-shadow 0.18s ease;
          }
          .plotTile:hover,
          .plotTile:focus-visible {
            transform: translateY(-2px);
            box-shadow: 0 14px 32px rgba(47, 57, 51, 0.09);
            border-color: #bcc9c2;
            outline: none;
          }
        `}</style>
      </main>
    );
  }

  const c = COPY[mode];
  const attachingToPlot = !!presetPlotId;
  const presetPlotReady = attachingToPlot ? !!presetPlot && !presetPlotError : true;

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">{attachingToPlot ? 'Adding to a resting place' : c.eyebrow}</div>
        <h2>{attachingToPlot ? 'Add another memorial to this plot.' : c.heading}</h2>
        <p className="muted">
          {attachingToPlot
            ? 'The QR code already engraved on the stone will simply update to include this person too — nothing to change on the stone itself.'
            : c.intro}
        </p>

        {attachingToPlot && presetPlotError && (
          <div
            className="card"
            style={{ marginTop: 16, background: '#fdecea', borderColor: '#f5c6c6' }}
          >
            <p style={{ margin: 0, color: '#a94442', fontSize: 14 }}>{presetPlotError}</p>
          </div>
        )}
        {attachingToPlot && presetPlot && (
          <div
            className="card"
            style={{ marginTop: 16, background: '#f0e8d8', borderColor: '#e0c890' }}
          >
            <div className="eyebrow" style={{ marginBottom: 4 }}>Existing plot</div>
            <p style={{ margin: 0, fontSize: 14 }}>
              <strong>{presetPlot.name || presetPlot.cemetery.name}</strong>
              {presetPlot.cemetery.address && (
                <span className="muted"> · {presetPlot.cemetery.address}</span>
              )}
            </p>
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
              Publishing this second memorial uses the reduced rate for additional names on the same plot.
            </p>
          </div>
        )}

        {!attachingToPlot && !isPartner && (
          <p style={{ fontSize: 13, marginTop: -6 }}>
            <button
              type="button"
              onClick={() => setMode(null)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--sage)',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              ← This is actually a different kind of page
            </button>
          </p>
        )}

        <form onSubmit={submit}>
          <label htmlFor="fullName">{c.nameLabel}</label>
          <input
            id="fullName"
            name="fullName"
            placeholder={c.namePlaceholder}
            required
            autoFocus
            defaultValue={draft.fullName || ''}
            onChange={(e) => persistDraft({ ...draft, fullName: e.target.value })}
          />

          {mode === 'memorial' ? (
            <>
              <div className="twoCol">
                <div>
                  <label htmlFor="born">Born</label>
                  <input
                    id="born"
                    name="born"
                    type="date"
                    defaultValue={draft.born || ''}
                    onChange={(e) => persistDraft({ ...draft, born: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="died">Died</label>
                  <input
                    id="died"
                    name="died"
                    type="date"
                    defaultValue={draft.died || ''}
                    onChange={(e) => persistDraft({ ...draft, died: e.target.value })}
                  />
                </div>
              </div>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Dates are optional. Leave either blank if you&rsquo;re not sure.
              </p>
            </>
          ) : (
            <>
              <label htmlFor="born">Born</label>
              <input
                id="born"
                name="born"
                type="date"
                defaultValue={draft.born || ''}
                onChange={(e) => persistDraft({ ...draft, born: e.target.value })}
              />
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Optional. You can add or change this at any time.
              </p>
            </>
          )}

          <label htmlFor="photo">A favourite photograph <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
          <input id="photo" name="photo" type="file" accept="image/*" />

          {error && (
            <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{error}</p>
          )}

          <button
            disabled={saving || !presetPlotReady}
            className="button"
            style={{ width: '100%', marginTop: 26 }}
          >
            {saving
              ? progress || 'Creating…'
              : attachingToPlot
                ? 'Add this memorial'
                : c.submitLabel}
          </button>

          <p className="muted" style={{ fontSize: 13, marginTop: 18, textAlign: 'center' }}>
            No payment yet — you&rsquo;ll only be asked when you decide to publish. Everything is
            private until then.
          </p>
        </form>
      </div>
    </main>
  );
}
