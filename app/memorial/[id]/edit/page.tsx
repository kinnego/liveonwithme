'use client';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { calculateAgeAtDeath } from '@/lib/age';
import { resizeForMobile } from '@/lib/image';
import type { Cemetery } from '@/lib/types';
import CemeteryPicker from '@/components/CemeteryPicker';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

export default function EditMemorial({ params }: { params: Promise<{ id: string }> }) {
  const [m, setM] = useState<any>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [born, setBorn] = useState('');
  const [died, setDied] = useState('');
  const [cemetery, setCemetery] = useState<Cemetery | null>(null);
  const [showDiedField, setShowDiedField] = useState(false);
  const router = useRouter();

  useEffect(() => {
    params.then(({ id }) =>
      onAuthStateChanged(auth, async (u) => {
        if (!u) return router.push('/auth');
        const snap = await getDoc(doc(db, 'memorials', id));
        if (!snap.exists() || snap.data().ownerId !== u.uid) {
          return router.push('/dashboard');
        }
        const data: any = { id: snap.id, ...snap.data() };
        setM(data);
        setBorn(data.born || '');
        setDied(data.died || '');
        setCemetery(data.cemetery || null);
        if (data.kind === 'legacy' && data.died) setShowDiedField(true);
      })
    );
  }, [params, router]);

  const derivedAge = calculateAgeAtDeath(born, died);

  async function uploadToR2(file: File, path: string, memorialId?: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', path);
    if (memorialId) formData.append('memorialId', memorialId);
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Photo upload failed');
    return data as { path: string; sizeBytes: number };
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!m) return;
    setSaving(true);
    setError('');

    try {
      const fd = new FormData(e.currentTarget);
      const nextFullName = String(fd.get('fullName'));
      const updates: Record<string, unknown> = {
        fullName: nextFullName,
        fullNameLower: nextFullName.toLowerCase(),
        born,
        died,
        ageAtDeath: calculateAgeAtDeath(born, died),
        epitaph: String(fd.get('epitaph') || ''),
        story: String(fd.get('story') || ''),
        visibility: String(fd.get('visibility') || 'unlisted'),
        cemetery: cemetery ?? null,
        updatedAt: serverTimestamp(),
      };
      // A legacy page transitions to a memorial the moment a died date is set.
      if (m.kind === 'legacy' && died) {
        updates.kind = 'memorial';
        if (m.personId) {
          try {
            await updateDoc(doc(db, 'persons', m.personId), {
              died,
              isLiving: false,
              updatedAt: serverTimestamp(),
            });
          } catch {
            // Non-blocking: the memorial doc is the source of truth for display.
          }
        }
      }

      const photo = fd.get('photo') as File;
      if (photo?.size) {
        const optimised = await resizeForMobile(photo);
        const heroPhotoPath = `memorials/${m.id}/${crypto.randomUUID()}-${optimised.name}`;
        const uploaded = await uploadToR2(optimised, heroPhotoPath, m.id);
        updates.heroPhotoPath = heroPhotoPath;
        updates.heroPhotoSize = uploaded.sizeBytes;
      }

      await updateDoc(doc(db, 'memorials', m.id), updates);
      router.push(`/memorial/${m.id}/manage`);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!m) return <PageSkeleton variant="form" label="Loading" />;

  const heroUrl = m.heroPhotoPath ? `${R2_PUBLIC_URL}/${m.heroPhotoPath}` : '';
  const isLegacy = m.kind === 'legacy';
  const pageWord = isLegacy ? 'page' : 'memorial';
  const nameLabel = isLegacy ? 'Full name' : 'Their full name';
  const epitaphLabel = isLegacy ? 'A few words beneath the name' : 'A few words beneath their name';
  const storyLabel = isLegacy ? 'The story' : 'Their story';

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">Edit {pageWord}</div>
        <h2>{m.fullName}</h2>
        <p className="muted">Change anything. It saves back to this {pageWord}.</p>

        <form onSubmit={submit}>
          <label htmlFor="fullName">{nameLabel}</label>
          <input id="fullName" name="fullName" defaultValue={m.fullName} required />

          {isLegacy && !showDiedField ? (
            <>
              <label htmlFor="born">Born</label>
              <input
                id="born"
                name="born"
                type="date"
                value={born}
                onChange={(e) => setBorn(e.target.value)}
              />
              <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setShowDiedField(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: 'var(--brand)',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  If the time has come, add a date of passing. This page becomes a memorial.
                </button>
              </p>
            </>
          ) : (
            <>
              <div className="twoCol">
                <div>
                  <label htmlFor="born">Born</label>
                  <input
                    id="born"
                    name="born"
                    type="date"
                    value={born}
                    onChange={(e) => setBorn(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="died">Died</label>
                  <input
                    id="died"
                    name="died"
                    type="date"
                    value={died}
                    onChange={(e) => setDied(e.target.value)}
                  />
                </div>
              </div>
              {derivedAge !== null && (
                <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                  Age at passing: <strong>{derivedAge}</strong>
                </p>
              )}
            </>
          )}

          <span className="fieldLabel">Cemetery or resting place</span>
          <CemeteryPicker value={cemetery} onChange={setCemetery} />

          <label htmlFor="photo" style={{ marginTop: 18 }}>A favourite photograph</label>
          {heroUrl && (
            <div style={{ margin: '6px 0 12px' }}>
              <img
                src={heroUrl}
                alt=""
                style={{
                  width: 140,
                  height: 140,
                  objectFit: 'cover',
                  borderRadius: 12,
                  border: '1px solid var(--line)',
                }}
              />
              <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                Choose a new file below to replace this photograph.
              </p>
            </div>
          )}
          <input id="photo" name="photo" type="file" accept="image/*" />

          <label htmlFor="epitaph">{epitaphLabel}</label>
          <input id="epitaph" name="epitaph" defaultValue={m.epitaph || ''} />

          <label htmlFor="story">{storyLabel}</label>
          <textarea id="story" name="story" defaultValue={m.story || ''} />

          <label htmlFor="visibility">Who can see it?</label>
          <select id="visibility" name="visibility" defaultValue={m.visibility || 'unlisted'}>
            <option value="unlisted">Only people with the link</option>
            <option value="private">Family only</option>
            <option value="public">Public</option>
          </select>

          {error && <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap' }}>
            <button disabled={saving} className="button">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <Link href={`/memorial/${m.id}/manage`} className="button secondary">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
