'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { resizeForMobile } from '@/lib/image';
import PhotoFocusEditor from '@/components/PhotoFocusEditor';

export const dynamic = 'force-dynamic';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
const MAX_FEATURED = 4;

export default function Gallery({ params }: { params: Promise<{ id: string }> }) {
  const [m, setM] = useState<any>();
  const [photos, setPhotos] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [focusEditing, setFocusEditing] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    let stop: any;
    params.then(({ id }) =>
      onAuthStateChanged(auth, async (u) => {
        if (!u) return router.push('/auth');
        const snap = await getDoc(doc(db, 'memorials', id));
        if (!snap.exists() || snap.data().ownerId !== u.uid) {
          return router.push('/dashboard');
        }
        setM({ id: snap.id, ...snap.data() });
        stop = onSnapshot(
          query(
            collection(db, 'contributions'),
            where('memorialId', '==', id),
            where('status', '==', 'approved')
          ),
          (s) =>
            setPhotos(
              s.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .filter((x: any) => x.photoPath)
            )
        );
      })
    );
    return () => stop?.();
  }, [params, router]);

  async function uploadToR2(file: File, path: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', path);
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Upload failed');
    return await res.json();
  }

  async function refreshMemorial() {
    if (!m) return;
    const snap = await getDoc(doc(db, 'memorials', m.id));
    if (snap.exists()) setM({ id: snap.id, ...snap.data() });
  }

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!m) return;
    const files = Array.from(fileInputRef.current?.files || []);
    if (files.length === 0) return;

    setUploading(true);
    setUploadError('');
    try {
      for (let i = 0; i < files.length; i++) {
        setUploadProgress(`Preparing photo ${i + 1} of ${files.length}…`);
        const optimised = await resizeForMobile(files[i]);
        setUploadProgress(`Uploading photo ${i + 1} of ${files.length}…`);
        const photoPath = `memorials/${m.id}/${crypto.randomUUID()}-${optimised.name}`;
        await uploadToR2(optimised, photoPath);
        await addDoc(collection(db, 'contributions'), {
          memorialId: m.id,
          contributorName: 'Family',
          relationship: '',
          memory: '',
          photoPath,
          caption: '',
          status: 'approved',
          source: 'family',
          createdAt: serverTimestamp(),
        });
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  }

  async function unpublish(id: string) {
    await updateDoc(doc(db, 'contributions', id), { status: 'pending' });
    const featured = new Set(m.featuredContributionIds || []);
    if (featured.has(id)) {
      featured.delete(id);
      await updateDoc(doc(db, 'memorials', m.id), {
        featuredContributionIds: Array.from(featured),
        updatedAt: serverTimestamp(),
      });
      await refreshMemorial();
    }
  }

  async function setDisplayMode(mode: 'square' | 'natural') {
    if (!m) return;
    await updateDoc(doc(db, 'memorials', m.id), {
      galleryDisplayMode: mode,
      updatedAt: serverTimestamp(),
    });
    await refreshMemorial();
  }

  async function saveFocal(id: string, focalX: number, focalY: number) {
    await updateDoc(doc(db, 'contributions', id), { focalX, focalY });
    setFocusEditing(null);
  }

  async function toggleFeature(id: string) {
    if (!m) return;
    const current: string[] = m.featuredContributionIds || [];
    let next: string[];
    if (current.includes(id)) {
      next = current.filter((x) => x !== id);
    } else {
      if (current.length >= MAX_FEATURED) return;
      next = [...current, id];
    }
    console.log('[favourite] uid=', auth.currentUser?.uid, 'ownerId=', m.ownerId, 'memorialId=', m.id);
    console.log('[favourite] memorial fields:', {
      status: m.status,
      paymentStatus: m.paymentStatus,
      salesChannel: m.salesChannel,
      funeralDirectorId: m.funeralDirectorId,
      referralId: m.referralId,
      visibility: m.visibility,
      hasStatus: 'status' in m,
      hasPaymentStatus: 'paymentStatus' in m,
      hasSalesChannel: 'salesChannel' in m,
      hasFuneralDirectorId: 'funeralDirectorId' in m,
      hasReferralId: 'referralId' in m,
    });
    try {
      await updateDoc(doc(db, 'memorials', m.id), {
        featuredContributionIds: next,
        updatedAt: serverTimestamp(),
      });
      await refreshMemorial();
    } catch (err) {
      console.error('[favourite] failed:', err);
      throw err;
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

  if (!m) return <main className="shell">Loading gallery…</main>;

  const featuredIds: string[] = m.featuredContributionIds || [];
  const featuredCount = featuredIds.length;
  const displayMode: 'square' | 'natural' = m.galleryDisplayMode === 'natural' ? 'natural' : 'square';

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Photographs</div>
          <h2 style={{ marginBottom: 0 }}>{m.fullName}</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            Star up to {MAX_FEATURED} favourites — they appear in a highlighted strip on the
            memorial. All published photographs also appear in the gallery below.
          </p>
        </div>
        <Link href={`/memorial/${m.id}/manage`} className="button secondary">
          Back to manage
        </Link>
      </div>

      <div className="formCard" style={{ margin: '20px 0' }}>
        <h3 style={{ marginTop: 0 }}>Add photographs</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Upload one or many at a time — we&rsquo;ll gently resize each so it looks crisp on a
          phone and loads quickly for everyone.
        </p>
        <form onSubmit={onUpload}>
          <input
            ref={fileInputRef}
            name="photos"
            type="file"
            accept="image/*"
            multiple
          />
          {uploadError && (
            <p style={{ color: '#a94442', marginTop: 12, fontSize: 14 }}>{uploadError}</p>
          )}
          <button className="button" style={{ marginTop: 16 }} disabled={uploading}>
            {uploading ? 'Working…' : 'Upload photographs'}
          </button>
          {uploading && uploadProgress && (
            <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>{uploadProgress}</p>
          )}
        </form>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          margin: '10px 0 20px',
          fontSize: 14,
          flexWrap: 'wrap',
        }}
      >
        <span className="muted">
          {featuredCount} of {MAX_FEATURED} favourites selected.
        </span>
        <div className="toolbar" role="radiogroup" aria-label="Gallery tile shape">
          <button
            type="button"
            role="radio"
            aria-checked={displayMode === 'square'}
            className={`button small ${displayMode === 'square' ? '' : 'secondary'}`}
            onClick={() => setDisplayMode('square')}
          >
            Square tiles
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={displayMode === 'natural'}
            className={`button small ${displayMode === 'natural' ? '' : 'secondary'}`}
            onClick={() => setDisplayMode('natural')}
          >
            Original shape
          </button>
        </div>
      </div>

      {photos.length === 0 ? (
        <div className="card">
          <h3>No photographs published yet</h3>
          <p className="muted">
            Upload above, or approve contributions from family and friends in the manage page.
          </p>
        </div>
      ) : (
        <div className="gallery">
          {photos.map((p) => {
            const isFeatured = featuredIds.includes(p.id);
            const canFeature = isFeatured || featuredCount < MAX_FEATURED;
            return (
              <div
                key={p.id}
                className="card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  position: 'relative',
                  outline: isFeatured ? '2px solid var(--sage)' : 'none',
                }}
              >
                <div
                  style={{
                    aspectRatio: displayMode === 'square' ? '1' : 'auto',
                    background: '#dde5df',
                    overflow: 'hidden',
                  }}
                >
                  <img
                    src={`${R2_PUBLIC_URL}/${p.photoPath}`}
                    alt={p.caption || 'Memory photograph'}
                    style={{
                      display: 'block',
                      width: '100%',
                      height: displayMode === 'square' ? '100%' : 'auto',
                      objectFit: displayMode === 'square' ? 'cover' : 'initial',
                      objectPosition:
                        displayMode === 'square'
                          ? `${(p.focalX ?? 0.5) * 100}% ${(p.focalY ?? 0.5) * 100}%`
                          : undefined,
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => canFeature && toggleFeature(p.id)}
                  aria-label={isFeatured ? 'Unfavourite' : 'Favourite'}
                  disabled={!canFeature}
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    background: isFeatured ? 'var(--sage)' : 'rgba(255,253,249,.92)',
                    color: isFeatured ? 'white' : 'var(--ink)',
                    border: '1px solid var(--line)',
                    borderRadius: 999,
                    padding: '6px 12px',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: canFeature ? 'pointer' : 'not-allowed',
                    opacity: canFeature ? 1 : 0.5,
                  }}
                >
                  {isFeatured ? '★ Favourite' : '☆ Favourite'}
                </button>
                <div style={{ padding: 16 }}>
                  <strong>{p.contributorName || 'Anonymous'}</strong>
                  {p.source === 'family' && (
                    <span className="muted" style={{ fontSize: 12 }}> · added by family</span>
                  )}
                  {p.relationship && !(p.source === 'family') && (
                    <span className="muted"> · {p.relationship}</span>
                  )}
                  {p.caption && <p style={{ marginTop: 6 }}>{p.caption}</p>}
                  <div className="toolbar" style={{ marginTop: 12 }}>
                    <button
                      className="button secondary small"
                      onClick={() => setFocusEditing(p)}
                    >
                      Adjust framing
                    </button>
                    <button
                      className="button secondary small"
                      onClick={() => download(p.photoPath, p.caption)}
                    >
                      Download
                    </button>
                    <button
                      className="button secondary small"
                      onClick={() => unpublish(p.id)}
                    >
                      Unpublish
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {focusEditing && (
        <PhotoFocusEditor
          src={`${R2_PUBLIC_URL}/${focusEditing.photoPath}`}
          initialFocalX={focusEditing.focalX}
          initialFocalY={focusEditing.focalY}
          onSave={(fx, fy) => saveFocal(focusEditing.id, fx, fy)}
          onCancel={() => setFocusEditing(null)}
        />
      )}
    </main>
  );
}
