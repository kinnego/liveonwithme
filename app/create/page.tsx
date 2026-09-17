'use client';
import { FormEvent, useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { calculateAgeAtDeath } from '@/lib/age';
import { resizeForMobile } from '@/lib/image';

export const dynamic = 'force-dynamic';

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export default function Create() {
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function uploadToR2(file: File, path: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', path);

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) throw new Error('Upload failed');
    return await res.json();
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auth.currentUser) {
      router.push('/auth');
      return;
    }

    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const fullName = String(fd.get('fullName'));
    const slug = `${slugify(fullName)}-${Math.random().toString(36).slice(2, 7)}`;
    const memorialRef = doc(db, 'memorials', slug);

    const born = String(fd.get('born') || '');
    const died = String(fd.get('died') || '');

    await setDoc(memorialRef, {
      ownerId: auth.currentUser.uid,
      slug,
      fullName,
      born,
      died,
      ageAtDeath: calculateAgeAtDeath(born, died),
      cemetery: null,
      featuredContributionIds: [],
      epitaph: String(fd.get('epitaph') || ''),
      story: String(fd.get('story') || ''),
      visibility: String(fd.get('visibility') || 'unlisted'),
      heroPhotoPath: '',
      status: 'draft',
      paymentStatus: 'unpaid',
      salesChannel: 'direct',
      funeralDirectorId: null,
      referralId: null,
      publishedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const photo = fd.get('photo') as File;
    if (photo?.size) {
      const optimised = await resizeForMobile(photo);
      const heroPhotoPath = `memorials/${slug}/${crypto.randomUUID()}-${optimised.name}`;
      await uploadToR2(optimised, heroPhotoPath);
      await updateDoc(memorialRef, {
        heroPhotoPath,
        updatedAt: serverTimestamp(),
      });
    }

    router.push(`/memorial/${slug}/manage`);
  }

  return (
    <main className="shell">
      <div className="formCard">
        <div className="eyebrow">Create a memorial</div>
        <h2>Tell us about them.</h2>
        <p className="muted">Start with the essentials. Everything can be changed later.</p>
        <form onSubmit={submit}>
          <label>Their full name</label>
          <input name="fullName" placeholder="Mary O'Donnell" required />

          <div className="twoCol">
            <div>
              <label>Born</label>
              <input name="born" type="date" />
            </div>
            <div>
              <label>Died</label>
              <input name="died" type="date" />
            </div>
          </div>

          <label>A favourite photograph</label>
          <input name="photo" type="file" accept="image/*" />

          <label>A few words beneath their name</label>
          <input name="epitaph" placeholder="She made everyone feel like they belonged." />

          <label>Their story</label>
          <textarea
            name="story"
            placeholder="Write this however feels natural. You can add more at any time…"
          />

          <label>Who can see it?</label>
          <select name="visibility" defaultValue="unlisted">
            <option value="unlisted">Only people with the link</option>
            <option value="private">Family only</option>
            <option value="public">Public</option>
          </select>

          <button disabled={saving} className="button" style={{ width: '100%', marginTop: 26 }}>
            {saving ? 'Creating…' : 'Create memorial'}
          </button>
        </form>
      </div>
    </main>
  );
}
