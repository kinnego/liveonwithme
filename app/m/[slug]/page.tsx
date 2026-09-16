'use client';
import { FormEvent, useEffect, useState } from 'react';
import {
  collection,
  addDoc,
  getDoc,
  getDocs,
  doc,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export const dynamic = 'force-dynamic';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

const demo = {
  id: 'demo',
  fullName: "Mary O'Donnell",
  born: '1948-03-12',
  died: '2025-11-04',
  epitaph: 'She made everyone feel like they belonged.',
  story: `Mary had an extraordinary way of making ordinary days feel important. Her kitchen was rarely quiet, the kettle was nearly always on, and there was always room for one more person at the table. She remembered birthdays, asked about the small things, and laughed with her whole face.

She loved her family fiercely, adored the sea, grew tomatoes with mixed success, and believed no journey was complete without something sweet for the road. This is a place for all the pieces of Mary that live on in the people who knew her.`,
  heroPhotoPath: '',
  slug: 'mary-demo',
};

export default function Memorial({ params }: { params: Promise<{ slug: string }> }) {
  const [memorial, setMemorial] = useState<any>();
  const [hero, setHero] = useState('');
  const [approved, setApproved] = useState<any[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);

  useEffect(() => {
    params.then(async (p) => {
      if (p.slug === 'mary-demo') return setMemorial(demo);

      const s = await getDoc(doc(db, 'memorials', p.slug));
      if (s.exists()) {
        const data = { id: s.id, ...s.data() };
        setMemorial(data);

        if ((data as any).heroPhotoPath) {
          setHero(`${R2_PUBLIC_URL}/${(data as any).heroPhotoPath}`);
        }

        const c = await getDocs(
          query(
            collection(db, 'contributions'),
            where('memorialId', '==', p.slug),
            where('status', '==', 'approved')
          )
        );

        const rows = c.docs.map((d) => ({ id: d.id, ...d.data() }));
        setApproved(rows);

        for (const row of rows) {
          if ((row as any).photoPath) {
            const url = `${R2_PUBLIC_URL}/${(row as any).photoPath}`;
            setPhotoUrls((x) => ({ ...x, [row.id]: url }));
          }
        }
      }
    });
  }, [params]);

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

  async function contribute(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!memorial || memorial.id === 'demo') {
      setSent(true);
      return;
    }

    const fd = new FormData(e.currentTarget);
    const photo = fd.get('photo') as File;
    let photoPath = '';

    if (photo?.size) {
      photoPath = `contributions/${memorial.id}/${crypto.randomUUID()}-${photo.name}`;
      await uploadToR2(photo, photoPath);
    }

    await addDoc(collection(db, 'contributions'), {
      memorialId: memorial.id,
      contributorName: String(fd.get('name')),
      contributorEmail: String(fd.get('email') || ''),
      relationship: String(fd.get('relationship') || ''),
      memory: String(fd.get('memory') || ''),
      caption: String(fd.get('caption') || ''),
      photoPath,
      status: 'pending',
      createdAt: serverTimestamp(),
    });

    setSent(true);
  }

  if (!memorial)
    return (
      <main className="shell">
        <p>Opening this memorial…</p>
      </main>
    );

  const years = `${memorial.born?.slice(0, 4) || ''} — ${memorial.died?.slice(0, 4) || ''}`;
  const photos = approved.filter((x) => x.photoPath);
  const memories = approved.filter((x) => x.memory);

  return (
    <main>
      <section
        className="memorialHero"
        style={
          hero
            ? {
                backgroundImage: `linear-gradient(rgba(22,30,27,.12),rgba(22,30,27,.68)),url(${hero})`,
              }
            : {}
        }
      >
        <div>
          <div className="dates">{years}</div>
          <h1>{memorial.fullName}</h1>
          <p style={{ fontFamily: 'Georgia,serif', fontSize: 22, fontStyle: 'italic' }}>
            {memorial.epitaph}
          </p>
        </div>
      </section>

      <div className="memorialNav">
        <a href="#story">Their story</a>
        <a href="#photos">Photographs</a>
        <a href="#memories">Memories</a>
        <a href="#share">Share something</a>
      </div>

      <section id="story" className="section">
        <div className="eyebrow center">Their life, remembered</div>
        <h2 className="center">The story of {memorial.fullName.split(' ')[0]}</h2>
        <div className="story">
          {String(memorial.story || '')
            .split('\n')
            .map((x: string, i: number) => (
              <p key={i}>{x}</p>
            ))}
        </div>
      </section>

      <section id="photos" className="section">
        <div className="eyebrow center">Photographs</div>
        <h2 className="center">Moments worth keeping</h2>
        <div className="gallery">
          {photos.length ? (
            photos.map((x) => (
              <div className="photo" key={x.id}>
                {photoUrls[x.id] && (
                  <img
                    src={photoUrls[x.id]}
                    alt={x.caption || `A memory of ${memorial.fullName}`}
                  />
                )}
              </div>
            ))
          ) : (
            <>
              <div className="photo"></div>
              <div className="photo"></div>
              <div className="photo"></div>
            </>
          )}
        </div>
        <p className="muted center">
          Photographs shared by family and friends only appear here after family approval.
        </p>
      </section>

      <section id="memories" className="section center">
        <div className="eyebrow">In their words</div>
        <h2>Memories of {memorial.fullName.split(' ')[0]}</h2>
        {memories.length ? (
          memories.map((x) => (
            <div key={x.id}>
              <div className="quote">"{x.memory}"</div>
              <p className="muted">
                — {x.contributorName}
                {x.relationship ? `, ${x.relationship}` : ''}
              </p>
            </div>
          ))
        ) : (
          <>
            <div className="quote">
              "The best thing about her was that you always left her house feeling better than
              when you arrived."
            </div>
            <p className="muted">— A family memory</p>
          </>
        )}
      </section>

      <section id="share" className="section">
        <div className="formCard">
          {sent ? (
            <div className="center">
              <div className="iconCircle" style={{ margin: '0 auto 20px' }}>
                ♡
              </div>
              <h2>Thank you.</h2>
              <p className="muted">
                Your contribution has been sent privately to the family. They can choose to add it
                to the memorial.
              </p>
            </div>
          ) : (
            <>
              <div className="eyebrow">Share something with the family</div>
              <h2>Do you have a memory or photograph?</h2>
              <p className="muted">
                What you send is private until the family chooses to publish it.
              </p>
              <form onSubmit={contribute}>
                <label>Your name</label>
                <input name="name" required />

                <div className="twoCol">
                  <div>
                    <label>Email (optional)</label>
                    <input name="email" type="email" />
                  </div>
                  <div>
                    <label>How did you know them?</label>
                    <input name="relationship" placeholder="Friend, cousin, colleague…" />
                  </div>
                </div>

                <label>Share a memory</label>
                <textarea name="memory" placeholder="A story, a small moment, something they used to say…" />

                <label>Add a photograph</label>
                <input name="photo" type="file" accept="image/*" />

                <label>Photo caption (optional)</label>
                <input name="caption" />

                <button className="button" style={{ marginTop: 24 }}>
                  Send privately to the family
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
