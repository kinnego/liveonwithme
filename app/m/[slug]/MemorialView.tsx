'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
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
import { PageSkeleton } from '@/components/Skeleton';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Captions from 'yet-another-react-lightbox/plugins/captions';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/captions.css';

export const dynamic = 'force-dynamic';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

const demoPhotoUrls: Record<string, string> = {
  'demo-hero': '/demo/liveonwithme_lifestyle_01.jpg',
  'demo-1': '/demo/liveonwithme_lifestyle_09.jpg',
  'demo-2': '/demo/liveonwithme_lifestyle_02.jpg',
  'demo-3': '/demo/liveonwithme_lifestyle_04.jpg',
  'demo-4': '/demo/liveonwithme_lifestyle_07.jpg',
  'demo-5': '/demo/liveonwithme_lifestyle_08.jpg',
  'demo-6': '/demo/liveonwithme_lifestyle_06.jpg',
  'demo-7': '/demo/liveonwithme_lifestyle_03.jpg',
  'demo-8': '/demo/liveonwithme_lifestyle_11.jpg',
  'demo-9': '/demo/liveonwithme_lifestyle_12.jpg',
  'demo-mem-photo-1': '/demo/liveonwithme_lifestyle_05.jpg',
  'demo-mem-photo-3': '/demo/liveonwithme_lifestyle_10.jpg',
};

const demoContributions = [
  {
    id: 'demo-1',
    photoPath: 'demo-1',
    caption: 'A quiet evening by the sea',
    contributorName: 'Aoife',
    relationship: 'Daughter',
    audience: 'public',
    focalX: 0.55,
    focalY: 0.4,
  },
  {
    id: 'demo-2',
    photoPath: 'demo-2',
    caption: 'The garden she loved',
    contributorName: 'Kieran',
    relationship: 'Son',
    audience: 'public',
    focalX: 0.5,
    focalY: 0.4,
  },
  {
    id: 'demo-3',
    photoPath: 'demo-3',
    caption: 'Tea in the afternoon, always',
    contributorName: 'Nora',
    relationship: 'Neighbour',
    audience: 'public',
    focalX: 0.5,
    focalY: 0.4,
  },
  {
    id: 'demo-4',
    photoPath: 'demo-4',
    caption: 'One of her Sunday walks along the coast',
    contributorName: 'Michael',
    relationship: 'Nephew',
    audience: 'public',
  },
  {
    id: 'demo-5',
    photoPath: 'demo-5',
    caption: 'On the bench at Killiney Hill',
    contributorName: 'Aoife',
    relationship: 'Daughter',
    audience: 'public',
  },
  {
    id: 'demo-6',
    photoPath: 'demo-6',
    caption: 'A supper that ran late',
    contributorName: 'Kieran',
    relationship: 'Son',
    audience: 'public',
  },
  {
    id: 'demo-7',
    photoPath: 'demo-7',
    caption: 'With Rusty at the shore',
    contributorName: 'Aoife',
    relationship: 'Daughter',
    audience: 'public',
  },
  {
    id: 'demo-8',
    photoPath: 'demo-8',
    caption: 'Her old boy Rusty',
    contributorName: 'Kieran',
    relationship: 'Son',
    audience: 'public',
  },
  {
    id: 'demo-9',
    photoPath: 'demo-9',
    caption: 'A quiet evening at the end of the garden',
    contributorName: 'Sinéad',
    relationship: 'Neighbour',
    audience: 'public',
  },
  {
    id: 'demo-mem-1',
    photoPath: 'demo-mem-photo-1',
    memory:
      "The best thing about her was that you always left her house feeling better than when you arrived. Every visit ended with something for the road — a scone, a story, or the last of the biscuits she'd swear she wasn't eating.",
    contributorName: 'Nora',
    relationship: 'Neighbour',
    audience: 'public',
  },
  {
    id: 'demo-mem-2',
    memory:
      "Mam wrote every birthday card by hand and always slipped a fiver inside 'for a treat'. She did it for grandchildren, grand-nieces, the postman's daughter — anyone she'd ever met.",
    contributorName: 'Aoife',
    relationship: 'Daughter',
    audience: 'public',
  },
  {
    id: 'demo-mem-3',
    photoPath: 'demo-mem-photo-3',
    memory:
      "She sang along to the radio while she peeled potatoes. Off-key, always the wrong lyrics, and completely unbothered by either. It was one of the happiest sounds in the world.",
    contributorName: 'Kieran',
    relationship: 'Son',
    audience: 'public',
  },
  {
    id: 'demo-mem-4',
    memory:
      "I was new to the road and she brought over a shepherd's pie on my second day. I've never forgotten it. She had a way of making you feel like you were already family.",
    contributorName: 'Sinéad',
    relationship: 'Neighbour',
    audience: 'public',
  },
];

const demo = {
  id: 'demo',
  fullName: "Mary O'Donnell",
  nickname: 'Mam',
  born: '1948-03-12',
  died: '2025-11-04',
  ageAtDeath: 77,
  epitaph: 'She made everyone feel like they belonged.',
  story: `Mary had an extraordinary way of making ordinary days feel important. Her kitchen was rarely quiet, the kettle was nearly always on, and there was always room for one more person at the table. She remembered birthdays, asked about the small things, and laughed with her whole face.

She loved her family fiercely, adored the sea, grew tomatoes with mixed success, and believed no journey was complete without something sweet for the road. She raised three children in a small house that somehow always had room for one more, kept up with every neighbour on the road, and was the first to arrive with a casserole whenever anyone needed one.

Mary spent forty-two years as a primary-school teacher in Dún Laoghaire. Generations of children learned to read on her lap. Long after they'd grown, she'd still meet them in town and ask how they were getting on — and remember every answer.

This is a place for all the pieces of Mary that live on in the people who knew her.`,
  heroPhotoUrl: demoPhotoUrls['demo-hero'],
  heroPhotoPath: '',
  slug: 'mary-demo',
  status: 'live',
  visibility: 'public',
  cemetery: {
    name: "Glasnevin Cemetery",
    address: 'Finglas Rd, Glasnevin, Dublin 11, Ireland',
    placeId: 'ChIJyaMkOMwOZ0gRXpImTPzTKN0',
    lat: 53.3719,
    lng: -6.2814,
  },
  featuredContributionIds: ['demo-1', 'demo-2', 'demo-3'],
  galleryDisplayMode: 'square',
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
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    params.then(async (p) => {
      if (p.slug === 'mary-demo') {
        setMemorial(demo);
        setHero(demo.heroPhotoUrl);
        setApproved(demoContributions);
        const urlMap: Record<string, string> = {};
        for (const c of demoContributions) {
          if ((c as any).photoPath) urlMap[c.id] = demoPhotoUrls[(c as any).photoPath];
        }
        setPhotoUrls(urlMap);
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

  // Single canonical list of images that can appear in the lightbox: hero
  // first, then gallery photos, then any memory attachments not already in
  // the gallery. Every clickable image resolves to an index in this array.
  // Kept above early returns so hook order stays stable across renders.
  const lightboxSlides = useMemo(() => {
    const slides: {
      key: string;
      src: string;
      alt: string;
      title?: string;
      description?: string;
    }[] = [];
    const seenIds = new Set<string>();
    const displayName = memorial?.fullName || '';
    if (hero) {
      slides.push({
        key: '__hero',
        src: hero,
        alt: displayName ? `Photograph of ${displayName}` : 'Hero photograph',
        title: displayName || undefined,
      });
    }
    const publicApprovedRows = approved.filter((x: any) => x.audience !== 'family_only');
    const galleryRows = publicApprovedRows.filter((x: any) => x.photoPath && !x.memory);
    const memoryRows = publicApprovedRows.filter((x: any) => x.memory && x.photoPath);
    const pushPhoto = (row: any) => {
      const url = photoUrls[row.id];
      if (!url || seenIds.has(row.id)) return;
      seenIds.add(row.id);
      const attribution = [row.contributorName, row.relationship].filter(Boolean).join(', ');
      slides.push({
        key: row.id,
        src: url,
        alt: row.caption || `A memory of ${displayName}`,
        title: row.caption || undefined,
        description: attribution || undefined,
      });
    };
    for (const row of galleryRows) pushPhoto(row);
    for (const row of memoryRows) pushPhoto(row);
    return slides;
  }, [hero, approved, photoUrls, memorial?.fullName]);

  async function uploadToR2(file: File, path: string, memorialId?: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', path);
    if (memorialId) formData.append('memorialId', memorialId);

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data as { path: string; sizeBytes: number };
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
    let sizeBytes = 0;

    if (photo?.size) {
      const optimised = await resizeForMobile(photo);
      photoPath = `contributions/${memorial.id}/${crypto.randomUUID()}-${optimised.name}`;
      try {
        const uploaded = await uploadToR2(optimised, photoPath, memorial.id);
        sizeBytes = uploaded.sizeBytes;
      } catch (err: any) {
        alert(err.message || 'We couldn\u2019t save that photo. Please try again.');
        return;
      }
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
      mediaType: photoPath ? 'photo' : 'text',
      sizeBytes,
      createdAt: serverTimestamp(),
    });

    setSent(true);
  }

  if (loadState === 'loading') {
    return <PageSkeleton variant="hero" label="Opening this memorial" />;
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

  const isLegacy = memorial.kind === 'legacy';
  const bornYear = memorial.born?.slice(0, 4) || '';
  const diedYear = memorial.died?.slice(0, 4) || '';
  const years = isLegacy
    ? bornYear
    : bornYear || diedYear
      ? `${bornYear} — ${diedYear}`
      : '';
  const publicApproved = approved.filter((x) => x.audience !== 'family_only');
  const photos = publicApproved.filter((x) => x.photoPath && !x.memory);
  const memories = publicApproved.filter((x) => x.memory);

  const openLightboxByKey = (key: string) => {
    const idx = lightboxSlides.findIndex((s) => s.key === key);
    if (idx >= 0) setLightboxIndex(idx);
  };
  const featuredIds: string[] = memorial.featuredContributionIds || [];
  const featuredPhotos = featuredIds
    .map((id) => photos.find((p) => p.id === id))
    .filter(Boolean) as any[];
  const cemetery = memorial.cemetery;
  const ageAtDeath = memorial.ageAtDeath;
  const firstName = memorial.fullName.split(' ')[0];
  const memoriesHeading = isLegacy
    ? `Messages for ${firstName}`
    : `Memories of ${firstName}`;
  const memoriesEyebrow = isLegacy ? 'Notes from family and friends' : 'In their words';
  const memoriesEmpty = isLegacy
    ? `Messages from family and friends will appear here.`
    : `Memories from family and friends will appear here.`;
  const contributionHeading = isLegacy
    ? `Would you like to share a note or photograph with ${firstName}?`
    : `Do you have a memory or photograph of ${firstName}?`;
  const contributionEyebrow = isLegacy
    ? `Share something with ${firstName} and the family`
    : 'Share something with the family';

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
        role={hero ? 'button' : undefined}
        tabIndex={hero ? 0 : undefined}
        onClick={hero ? () => openLightboxByKey('__hero') : undefined}
        onKeyDown={
          hero
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openLightboxByKey('__hero');
                }
              }
            : undefined
        }
        style={
          hero
            ? {
                backgroundImage: `linear-gradient(rgba(22,30,27,.12),rgba(22,30,27,.68)),url(${hero})`,
                cursor: 'pointer',
              }
            : {}
        }
      >
        <div>
          <div className="dates">
            {years}
            {!isLegacy && ageAtDeath !== undefined && ageAtDeath !== null && (
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
                <Link
                  href={`/cemetery/${encodeURIComponent(cemetery.placeId)}?name=${encodeURIComponent(cemetery.name)}`}
                  style={{ textDecoration: 'underline', color: 'inherit' }}
                >
                  {cemetery.name}
                </Link>
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
              <button
                type="button"
                key={x.id}
                onClick={() => openLightboxByKey(x.id)}
                aria-label={x.caption || `Open photograph of ${memorial.fullName}`}
                style={{
                  aspectRatio: '3/4',
                  borderRadius: 20,
                  overflow: 'hidden',
                  boxShadow: 'var(--shadow)',
                  background: '#dde5df',
                  padding: 0,
                  border: 0,
                  cursor: 'pointer',
                  display: 'block',
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
              </button>
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
              <button
                type="button"
                className="photo"
                key={x.id}
                onClick={() => openLightboxByKey(x.id)}
                aria-label={x.caption || `Open photograph of ${memorial.fullName}`}
                style={{ padding: 0, border: 0, cursor: 'pointer' }}
              >
                {photoUrls[x.id] && (
                  <img
                    src={photoUrls[x.id]}
                    alt={x.caption || `A memory of ${memorial.fullName}`}
                    style={{
                      objectPosition: `${(x.focalX ?? 0.5) * 100}% ${(x.focalY ?? 0.5) * 100}%`,
                    }}
                  />
                )}
              </button>
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
        <div className="eyebrow">{memoriesEyebrow}</div>
        <h2>{memoriesHeading}</h2>
        {memories.length ? (
          memories.map((x) => (
            <div key={x.id} style={{ marginBottom: 45 }}>
              {x.photoPath && photoUrls[x.id] && (
                <button
                  type="button"
                  onClick={() => openLightboxByKey(x.id)}
                  aria-label={`Open photograph shared by ${x.contributorName}`}
                  style={{
                    maxWidth: 520,
                    margin: '0 auto 22px',
                    borderRadius: 20,
                    overflow: 'hidden',
                    boxShadow: 'var(--shadow)',
                    padding: 0,
                    border: 0,
                    background: 'transparent',
                    cursor: 'pointer',
                    display: 'block',
                    width: '100%',
                  }}
                >
                  <img
                    src={photoUrls[x.id]}
                    alt={`A memory shared by ${x.contributorName}`}
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  />
                </button>
              )}
              <div className="quote">&ldquo;{x.memory}&rdquo;</div>
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
          <p className="muted">{memoriesEmpty}</p>
        )}
        {isPreview && (
          <div style={{ marginTop: 24 }}>
            <Link href={`/memorial/${memorial.id}/memories`} className="button secondary small">
              {memories.length ? 'Edit memories' : 'Write a memory'}
            </Link>
          </div>
        )}
      </section>

      {!isPreview && memorial.id === 'demo' && (
        <section id="share" className="section">
          <div className="formCard">
            <div className="eyebrow">See how contributing works</div>
            <h2>Anyone can add a memory or a photograph — in about a minute.</h2>
            <p className="muted">
              On a real memorial, family and friends see a form like this. They write a
              short memory, add a photograph if they have one, and send it. The family
              reviews everything before anything appears publicly.
            </p>

            <ol
              style={{
                display: 'grid',
                gap: 14,
                margin: '26px 0 30px',
                paddingLeft: 20,
              }}
            >
              <li>
                <strong>Write a short memory.</strong>{' '}
                <span className="muted">
                  A story, a small moment, something they used to say. No account needed.
                </span>
              </li>
              <li>
                <strong>Add a photograph.</strong>{' '}
                <span className="muted">
                  Straight from your phone. It&rsquo;s resized automatically.
                </span>
              </li>
              <li>
                <strong>Send it privately to the family.</strong>{' '}
                <span className="muted">
                  They can publish it to the memorial, or keep it just for themselves.
                </span>
              </li>
            </ol>

            <fieldset
              disabled
              aria-label="Sample contribution form — disabled for this demo"
              style={{
                border: '1px dashed var(--line)',
                borderRadius: 14,
                padding: '20px 22px',
                background: '#fbfaf5',
                opacity: 0.9,
              }}
            >
              <label>Your name</label>
              <input value="Anna Byrne" readOnly />

              <div className="twoCol">
                <div>
                  <label>Email (optional)</label>
                  <input value="anna@example.com" readOnly />
                </div>
                <div>
                  <label>How did you know them?</label>
                  <input value="Old friend" readOnly />
                </div>
              </div>

              <label>Share a memory</label>
              <textarea
                readOnly
                value="Mary used to save me a scone every Sunday after mass. Nobody made me feel more at home."
              />

              <label>Add a photograph</label>
              <input type="text" value="beach-1998.jpg (2.1 MB)" readOnly />

              <label>Photo caption (optional)</label>
              <input value="At the beach in Kerry, 1998" readOnly />

              <button
                type="button"
                className="button"
                disabled
                style={{ marginTop: 24, cursor: 'not-allowed' }}
              >
                Send to the family (disabled — demo)
              </button>
            </fieldset>

            <div
              style={{
                marginTop: 24,
                padding: '14px 18px',
                background: '#fff6e5',
                border: '1px solid #f0d9a4',
                borderRadius: 12,
                fontSize: 14,
              }}
              role="note"
            >
              <strong>This is a demonstration memorial.</strong> The form above is
              disabled — nothing you type here will be sent. On a real memorial page,
              this is exactly how a friend, neighbour or family member would share
              something.
            </div>

            <div className="center" style={{ marginTop: 28 }}>
              <Link href="/create" className="button">
                Create a memorial like this
              </Link>
              <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
                It takes about two minutes to set up.
              </p>
            </div>
          </div>
        </section>
      )}

      {!isPreview && memorial.id !== 'demo' && (
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
                <div className="eyebrow">{contributionEyebrow}</div>
                <h2>{contributionHeading}</h2>
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

      <Lightbox
        open={lightboxIndex >= 0}
        close={() => setLightboxIndex(-1)}
        index={Math.max(0, lightboxIndex)}
        slides={lightboxSlides.map(({ src, alt, title, description }) => ({
          src,
          alt,
          title,
          description,
        }))}
        plugins={[Zoom, Captions]}
        controller={{ closeOnBackdropClick: true }}
        zoom={{ maxZoomPixelRatio: 3, scrollToZoom: true }}
        carousel={{ finite: lightboxSlides.length <= 1 }}
        styles={{ container: { backgroundColor: 'rgba(15, 22, 20, 0.94)' } }}
      />
    </main>
  );
}
