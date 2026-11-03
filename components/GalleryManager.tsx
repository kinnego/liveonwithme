// Shared gallery manager — the upload + favourites + photo grid that lets a
// keeper curate the images on a memorial. Rendered both inline on the edit
// page (so a keeper can add photos without navigating elsewhere) and on the
// dedicated /memorial/[id]/gallery page (where it&apos;s the whole screen).
//
// Keeps its own listener on contributions and its own in-flight upload state;
// consumers only hand in the memorialId and a `variant` that tunes the
// density + which secondary actions appear.

'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
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
import { auth, db } from '@/lib/firebase';
import { resizeForMobile } from '@/lib/image';
import { photoSrc, photoSrcSet } from '@/lib/images';
import PhotoFocusEditor from './PhotoFocusEditor';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
const MAX_FEATURED = 4;

interface Props {
  memorialId: string;
  variant?: 'full' | 'inline';
}

interface Photo {
  id: string;
  photoPath?: string;
  photoVariants?: boolean;
  caption?: string;
  contributorName?: string;
  relationship?: string;
  source?: string;
  focalX?: number;
  focalY?: number;
}

interface MemorialSlim {
  id: string;
  featuredContributionIds?: string[];
  galleryDisplayMode?: 'square' | 'natural';
}

async function uploadToR2(file: File, memorialId: string) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('kind', 'memorial-gallery');
  formData.append('memorialId', memorialId);
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data as { path: string; variants: boolean; sizeBytes: number };
}

export default function GalleryManager({ memorialId, variant = 'full' }: Props) {
  const [m, setM] = useState<MemorialSlim | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [focusEditing, setFocusEditing] = useState<Photo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isInline = variant === 'inline';

  useEffect(() => {
    let active = true;
    (async () => {
      const snap = await getDoc(doc(db, 'memorials', memorialId));
      if (!active) return;
      if (snap.exists()) {
        const d = snap.data() as any;
        setM({
          id: snap.id,
          featuredContributionIds: d.featuredContributionIds || [],
          galleryDisplayMode: d.galleryDisplayMode,
        });
      }
    })();
    const stop = onSnapshot(
      query(
        collection(db, 'contributions'),
        where('memorialId', '==', memorialId),
        where('status', '==', 'approved'),
      ),
      (s) =>
        setPhotos(
          s.docs
            .map((d) => ({ id: d.id, ...(d.data() as any) }))
            .filter((x: any) => x.photoPath),
        ),
    );
    return () => {
      active = false;
      stop();
    };
  }, [memorialId]);

  async function refreshMemorial() {
    const snap = await getDoc(doc(db, 'memorials', memorialId));
    if (!snap.exists()) return;
    const d = snap.data() as any;
    setM({
      id: snap.id,
      featuredContributionIds: d.featuredContributionIds || [],
      galleryDisplayMode: d.galleryDisplayMode,
    });
  }

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const files = Array.from(fileInputRef.current?.files || []);
    if (files.length === 0) return;

    setUploading(true);
    setUploadError('');
    try {
      for (let i = 0; i < files.length; i++) {
        setUploadProgress(`Preparing photo ${i + 1} of ${files.length}…`);
        const optimised = await resizeForMobile(files[i]);
        setUploadProgress(`Uploading photo ${i + 1} of ${files.length}…`);
        const uploaded = await uploadToR2(optimised, memorialId);
        await addDoc(collection(db, 'contributions'), {
          memorialId,
          contributorName: 'Family',
          relationship: '',
          memory: '',
          photoPath: uploaded.path,
          photoVariants: uploaded.variants,
          caption: '',
          status: 'approved',
          source: 'family',
          mediaType: 'photo',
          sizeBytes: uploaded.sizeBytes,
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

  async function toggleFeature(photoId: string) {
    if (!m) return;
    const current: string[] = m.featuredContributionIds || [];
    let next: string[];
    if (current.includes(photoId)) {
      next = current.filter((x) => x !== photoId);
    } else {
      if (current.length >= MAX_FEATURED) return;
      next = [...current, photoId];
    }
    await updateDoc(doc(db, 'memorials', memorialId), {
      featuredContributionIds: next,
      updatedAt: serverTimestamp(),
    });
    await refreshMemorial();
  }

  async function unpublish(photoId: string) {
    await updateDoc(doc(db, 'contributions', photoId), { status: 'pending' });
    const featured = new Set(m?.featuredContributionIds || []);
    if (featured.has(photoId)) {
      featured.delete(photoId);
      await updateDoc(doc(db, 'memorials', memorialId), {
        featuredContributionIds: Array.from(featured),
        updatedAt: serverTimestamp(),
      });
      await refreshMemorial();
    }
  }

  async function setDisplayMode(mode: 'square' | 'natural') {
    await updateDoc(doc(db, 'memorials', memorialId), {
      galleryDisplayMode: mode,
      updatedAt: serverTimestamp(),
    });
    await refreshMemorial();
  }

  async function saveFocal(id: string, focalX: number, focalY: number) {
    await updateDoc(doc(db, 'contributions', id), { focalX, focalY });
    setFocusEditing(null);
  }

  function download(path: string, name?: string) {
    const url = `${R2_PUBLIC_URL}/${path}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'memory-photo';
    a.target = '_blank';
    a.click();
  }

  if (!m) return null;

  const featuredIds: string[] = m.featuredContributionIds || [];
  const featuredCount = featuredIds.length;
  const displayMode: 'square' | 'natural' = m.galleryDisplayMode === 'natural' ? 'natural' : 'square';

  return (
    <div>
      <div className={isInline ? '' : 'formCard'} style={isInline ? { marginBottom: 20 } : { margin: '20px 0' }}>
        {!isInline && <h3 style={{ marginTop: 0 }}>Add photographs</h3>}
        {!isInline && (
          <p className="muted" style={{ marginTop: 0 }}>
            Upload one or many at a time. We&rsquo;ll gently resize each so it looks crisp on a
            phone and loads quickly for everyone.
          </p>
        )}
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
          <button className="button" style={{ marginTop: 12 }} disabled={uploading} type="submit">
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
          margin: '10px 0 16px',
          fontSize: 14,
          flexWrap: 'wrap',
        }}
      >
        <span className="muted">
          {featuredCount} of {MAX_FEATURED} favourites selected. Starred photos appear in a
          highlighted strip on the memorial.
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
        <p className="muted" style={{ fontSize: 14 }}>
          No photographs yet. Upload above or ask family and friends to contribute.
        </p>
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
                  {p.photoPath && (
                    <img
                      src={photoSrc(p.photoPath, p.photoVariants, 800)}
                      srcSet={photoSrcSet(p.photoPath, p.photoVariants)}
                      sizes="(max-width: 800px) 100vw, 343px"
                      alt={p.caption || 'Memory photograph'}
                      loading="lazy"
                      decoding="async"
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
                  )}
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
                <div style={{ padding: 14 }}>
                  <strong>{p.contributorName || 'Anonymous'}</strong>
                  {p.source === 'family' && (
                    <span className="muted" style={{ fontSize: 12 }}> · added by family</span>
                  )}
                  {p.relationship && p.source !== 'family' && (
                    <span className="muted"> · {p.relationship}</span>
                  )}
                  {p.caption && <p style={{ marginTop: 6 }}>{p.caption}</p>}
                  <div className="toolbar" style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => setFocusEditing(p)}
                    >
                      Adjust framing
                    </button>
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => p.photoPath && download(p.photoPath, p.caption)}
                    >
                      Download
                    </button>
                    <button
                      type="button"
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

      {focusEditing && focusEditing.photoPath && (
        <PhotoFocusEditor
          src={`${R2_PUBLIC_URL}/${focusEditing.photoPath}`}
          initialFocalX={focusEditing.focalX}
          initialFocalY={focusEditing.focalY}
          onSave={(fx, fy) => saveFocal(focusEditing.id, fx, fy)}
          onCancel={() => setFocusEditing(null)}
        />
      )}
    </div>
  );
}
