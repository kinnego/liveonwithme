'use client';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useRouter, useSearchParams } from 'next/navigation';
import { calculateAgeAtDeath } from '@/lib/age';
import { resizeForMobile } from '@/lib/image';
import { createPerson } from '@/lib/person';
import { slugify } from '@/lib/ids';
import { writeAudit } from '@/lib/audit';
import { attachMemorialToExistingPlot } from '@/lib/plot';
import type { MemorialKind, Plot } from '@/lib/types';
import { PageSkeleton } from '@/components/Skeleton';

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetPlotId = searchParams?.get('plot') || '';

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

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
    if (!user || !presetPlotId || !db) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'plots', presetPlotId));
        if (!snap.exists()) {
          setPresetPlotError('That plot could not be found.');
          return;
        }
        const p = { id: snap.id, ...(snap.data() as any) } as Plot;
        const canAdd =
          p.plotAdminUid === user.uid ||
          (p.plotAdminSuccessorUids || []).includes(user.uid);
        if (!canAdd) {
          setPresetPlotError('Only the plot administrator can add memorials to this plot.');
          return;
        }
        setPresetPlot(p);
      } catch (err: any) {
        setPresetPlotError(err?.message || 'Could not load that plot.');
      }
    })();
  }, [user, presetPlotId]);

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

  async function uploadToR2(file: File, path: string, memorialId?: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', path);
    if (memorialId) formData.append('memorialId', memorialId);
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
        kind: mode,
        born,
        died,
        ageAtDeath: died ? calculateAgeAtDeath(born, died) : null,
        cemetery: presetPlot?.cemetery ?? null,
        featuredContributionIds: [],
        epitaph: '',
        story: '',
        visibility: 'unlisted',
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
        const heroPhotoPath = `memorials/${slug}/${crypto.randomUUID()}-${optimised.name}`;
        const uploaded = await uploadToR2(optimised, heroPhotoPath, slug);
        await updateDoc(memorialRef, {
          heroPhotoPath,
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

        {!attachingToPlot && (
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
