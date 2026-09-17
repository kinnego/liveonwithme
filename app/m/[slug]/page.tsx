'use client';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
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
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { resizeForMobile } from '@/lib/image';

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
  status: 'live',
};

type LoadState = 'loading' | 'not_found' | 'draft_no_access' | 'ready';

export default function Memorial({ params }: { params: Promise<{ slug: string }> }) {
  const [memorial, setMemorial] = useState<any>();
  const [hero, setHero] = useState('');
  const [approved, setApproved] = useState<any[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [isPreview, setIsPreview] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    params.then(async (p) => {
      if (p.slug === 'mary-demo') {
        setMemorial(demo);
        setLoadState('ready');
        return;
      }

      const s = await getDoc(doc(db, 'memorials', p.slug));
      if (!s.exists()) {
        setLoadState('not_found');
        return;
      }

      const data: any = { id: s.id, ...s.data() };
      const isOwner = user?.uid === data.ownerId;
      const isLive = data.status === 'live';

      if (!isLive && !isOwner) {
        setLoadState('draft_no_access');
        return;
      }

      setMemorial(data);
      setIsPreview(!isLive && isOwner);

      if (data.heroPhotoPath) {
        setHero(`${R2_PUBLIC_URL}/${data.heroPhotoPath}`);
      }

      if (isLive || isOwner) {
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

      setLoadState('ready');
    });
  }, [params, user]);

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
    if (!memorial || memorial.id === 'demo' || isPreview) {
      setSent(true);
      return;
    }

    const fd = new FormData(e.currentTarget);
    const photo = fd.get('photo') as File;
    let photoPath = '';

    if (photo?.size) {
      const optimised = await resizeForMobile(photo);
      photoPath = `contributions/${memorial.id}/${crypto.randomUUID()}-${optimised.name}`;
      await uploadToR2(optimised, photoPath);
    }

    const audience = fd.get('audience') === 'family_only' ? 'family_only' : 'public';
    await addDoc(collection(db, 'contributions'), {
      memorialId: memorial.id,
      contributorName: String(fd.get('name')),
      contributorEmail: String(fd.get('email') || ''),
      relationship: String(fd.get('relationship') || ''),
      memory: String(fd.get('memory') || ''),
      caption: String(fd.get('caption') || ''),
      photoPath,
      status: 'pending',
      audience,
      createdAt: serverTimestamp(),
    });

    setSent(true);
  }

  if (loadState === 'loading') {
    return (
      <main className="shell">
        <p>Opening this memorial…</p>
      </main>
    );
  }

  if (loadState === 'not_found' || loadState === 'draft_no_access') {
    return (
      <main className="shell">
        <div className="formCard center">
          <h2>Memorial not found</h2>
          <p className="muted">
            This memorial may have been moved, or it isn't published yet.
          </p>
          <Link href="/" className="button" style={{ marginTop: 20 }}>
            Return home
          </Link>
        </div>
      </main>
    );
  }

  const years = `${memorial.born?.slice(0, 4) || ''} — ${memorial.died?.slice(0, 4) || ''}`;
  const publicApproved = approved.filter((x) => x.audience !== 'family_only');
  const photos = publicApproved.filter((x) => x.photoPath);
  const memories = publicApproved.filter((x) => x.memory);
  const featuredIds: string[] = memorial.featuredContributionIds || [];
  const featuredPhotos = featuredIds
    .map((id) => photos.find((p) => p.id === id))
    .filter(Boolean) as any[];
  const cemetery = memorial.cemetery;
  const ageAtDeath = memorial.ageAtDeath;

  return (
    <main>
      {isPreview && (
        <div
          style={{
            background: '#b28f69',
            color: 'white',
            textAlign: 'center',
            padding: '10px 16px',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Preview mode — this is how visitors will see it. Only you can view this until it's live.{' '}
          <Link
            href={`/memorial/${memorial.id}/manage`}
            style={{ textDecoration: 'underline', marginLeft: 8 }}
          >
            Go back to manage
          </Link>
        </div>
      )}

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
          <div className="dates">
            {years}
            {ageAtDeath !== undefined && ageAtDeath !== null && (
              <span style={{ marginLeft: 12 }}>· Aged {ageAtDeath}</span>
            )}
          </div>
          <h1>{memorial.fullName}</h1>
          <p style={{ fontFamily: 'Georgia,serif', fontSize: 22, fontStyle: 'italic' }}>
            {memorial.epitaph}
          </p>
          {cemetery?.name && (
            <p style={{ marginTop: 12, fontSize: 15, opacity: 0.9 }}>
              Resting at{' '}
              {cemetery.placeId ? (
                <a
                  href={`https://www.google.com/maps/place/?q=place_id:${cemetery.placeId}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'underline', color: 'inherit' }}
                >
                  {cemetery.name}
                </a>
              ) : (
                cemetery.name
              )}
            </p>
          )}
        </div>
      </section>

      <div className="memorialNav">
        <a href="#story">Their story</a>
        {featuredPhotos.length > 0 && <a href="#favourites">Favourites</a>}
        <a href="#photos">Photographs</a>
        <a href="#memories">Memories</a>
        {!isPreview && <a href="#share">Share something</a>}
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

      {featuredPhotos.length > 0 && (
        <section id="favourites" className="section">
          <div className="eyebrow center">Favourites</div>
          <h2 className="center">The photographs the family holds closest</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(featuredPhotos.length, 4)}, 1fr)`,
              gap: 14,
              marginTop: 35,
            }}
            className="favourites"
          >
            {featuredPhotos.map((x) => (
              <div
                key={x.id}
                style={{
                  aspectRatio: '3/4',
                  borderRadius: 20,
                  overflow: 'hidden',
                  boxShadow: 'var(--shadow)',
                  background: '#dde5df',
                }}
              >
                {photoUrls[x.id] && (
                  <img
                    src={photoUrls[x.id]}
                    alt={x.caption || `A memory of ${memorial.fullName}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: `${(x.focalX ?? 0.5) * 100}% ${(x.focalY ?? 0.5) * 100}%`,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section id="photos" className="section">
        <div className="eyebrow center">Photographs</div>
        <h2 className="center">Moments worth keeping</h2>
        <div className={`gallery ${memorial.galleryDisplayMode === 'natural' ? 'natural' : ''}`}>
          {photos.length ? (
            photos.map((x) => (
              <div className="photo" key={x.id}>
                {photoUrls[x.id] && (
                  <img
                    src={photoUrls[x.id]}
                    alt={x.caption || `A memory of ${memorial.fullName}`}
                    style={{
                      objectPosition: `${(x.focalX ?? 0.5) * 100}% ${(x.focalY ?? 0.5) * 100}%`,
                    }}
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
        ) : memorial.id === 'demo' ? (
          <>
            <div className="quote">
              "The best thing about her was that you always left her house feeling better than
              when you arrived."
            </div>
            <p className="muted">— A family memory</p>
          </>
        ) : isPreview ? (
          <p className="muted">
            No memories yet. Write the first one so it appears here when the memorial goes live.
          </p>
        ) : (
          <p className="muted">Memories from family and friends will appear here.</p>
        )}
        {isPreview && (
          <div style={{ marginTop: 24 }}>
            <Link href={`/memorial/${memorial.id}/memories`} className="button secondary small">
              {memories.length ? 'Edit memories' : 'Write a memory'}
            </Link>
          </div>
        )}
      </section>

      {!isPreview && (
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

                  <fieldset
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 14,
                      padding: '14px 18px',
                      marginTop: 22,
                    }}
                  >
                    <legend style={{ fontSize: 13, fontWeight: 750, padding: '0 6px' }}>
                      Who is this for?
                    </legend>
                    <label
                      style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'flex-start',
                        margin: '8px 0',
                        fontWeight: 500,
                      }}
                    >
                      <input
                        type="radio"
                        name="audience"
                        value="public"
                        defaultChecked
                        style={{ width: 'auto', marginTop: 4 }}
                      />
                      <span>
                        Share with family and friends on the memorial (the family will review before
                        it appears)
                      </span>
                    </label>
                    <label
                      style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'flex-start',
                        margin: '8px 0',
                        fontWeight: 500,
                      }}
                    >
                      <input
                        type="radio"
                        name="audience"
                        value="family_only"
                        style={{ width: 'auto', marginTop: 4 }}
                      />
                      <span>Just share it privately with the family — do not add it to the memorial</span>
                    </label>
                  </fieldset>

                  <button className="button" style={{ marginTop: 24 }}>
                    Send to the family
                  </button>
                </form>
              </>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
