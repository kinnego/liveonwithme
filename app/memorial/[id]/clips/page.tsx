'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { canEditMemorial } from '@/lib/roles';
import { pronounsFor } from '@/lib/pronouns';
import type { Memorial, MemorialClip } from '@/lib/types';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

async function uploadClip(file: File, memorialId: string) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('kind', 'memorial-clip');
  formData.append('memorialId', memorialId);
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data as { path: string; sizeBytes: number; contentType?: string };
}

export default function MemorialClipsPage({ params }: { params: Promise<{ id: string }> }) {
  const [m, setM] = useState<any>();
  const [items, setItems] = useState<MemorialClip[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    let stop: (() => void) | undefined;
    let stopAuth: (() => void) | undefined;
    params.then(({ id }) => {
      stopAuth = onAuthStateChanged(auth, async (u) => {
        stop?.();
        stop = undefined;
        if (!u) {
          router.push('/auth');
          return;
        }
        const snap = await getDoc(doc(db, 'memorials', id));
        if (!snap.exists() || !canEditMemorial(u.uid, snap.data() as Memorial)) {
          return router.push('/dashboard');
        }
        setM({ id: snap.id, ...snap.data() });
        stop = onSnapshot(
          query(collection(db, 'memorials', id, 'clips'), orderBy('createdAt', 'asc')),
          (s) => setItems(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as MemorialClip[]),
        );
      });
    });
    return () => {
      stopAuth?.();
      stop?.();
    };
  }, [params, router]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!m) return;
    setSaving(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const label = String(fd.get('label') || '').trim();
    const file = fd.get('clip') as File | null;
    if (!label) {
      setError('Give the recording a short label — e.g. "Dad whistling" or "A voicemail from Mum".');
      setSaving(false);
      return;
    }
    if (!file || file.size === 0) {
      setError('Choose an audio file to upload.');
      setSaving(false);
      return;
    }
    try {
      const uploaded = await uploadClip(file, m.id);
      await addDoc(collection(db, 'memorials', m.id, 'clips'), {
        memorialId: m.id,
        path: uploaded.path,
        mimeType: uploaded.contentType || file.type || 'audio/mpeg',
        sizeBytes: uploaded.sizeBytes,
        label,
        createdAt: serverTimestamp(),
      });
      (e.target as HTMLFormElement).reset();
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setError(err?.message || 'Could not save the recording.');
    } finally {
      setSaving(false);
    }
  }

  async function saveLabel(id: string) {
    const next = editingLabel.trim();
    if (!next || !m) return;
    await updateDoc(doc(db, 'memorials', m.id, 'clips', id), { label: next });
    setEditingId(null);
    setEditingLabel('');
  }

  async function remove(id: string) {
    if (!m) return;
    if (!confirm('Remove this recording from the memorial?')) return;
    await deleteDoc(doc(db, 'memorials', m.id, 'clips', id));
  }

  if (!m) return <PageSkeleton variant="detail" label="Loading recordings" />;

  const pronouns = pronounsFor(m.gender);
  const firstName = m.fullName.split(' ')[0];

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Recordings</div>
          <h2 style={{ marginBottom: 0 }}>{m.fullName}</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            Short audio clips of {firstName} — a voicemail {pronouns.subject} left, {pronouns.object}{' '}
            singing, a bit of a speech. Visitors see a small play button for each on the memorial
            page.
          </p>
        </div>
        <Link href={`/memorial/${m.id}`} className="button secondary">
          Back
        </Link>
      </div>

      <div className="formCard" style={{ margin: '20px 0' }}>
        <h3 style={{ marginTop: 0 }}>Add a recording</h3>
        <form onSubmit={submit}>
          <label htmlFor="clip-label">Label</label>
          <input
            id="clip-label"
            name="label"
            type="text"
            maxLength={80}
            placeholder={`e.g. ${firstName}'s voicemail, 2018`}
            required
          />

          <label htmlFor="clip-file" style={{ marginTop: 14 }}>
            Audio file
          </label>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>
            MP3, M4A, OGG or WAV. Up to 50&nbsp;MB.
          </p>
          <input
            ref={fileInputRef}
            id="clip-file"
            name="clip"
            type="file"
            accept="audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/*"
            required
          />

          {error && <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{error}</p>}

          <div style={{ marginTop: 20 }}>
            <button className="button" disabled={saving}>
              {saving ? 'Uploading…' : 'Add recording'}
            </button>
          </div>
        </form>
      </div>

      {items.length === 0 ? (
        <div className="card">
          <p className="muted">
            No recordings yet. The first one you add above will appear here and on the memorial.
          </p>
        </div>
      ) : (
        items.map((item) => (
          <div className="card" key={item.id} style={{ marginBottom: 12 }}>
            {editingId === item.id ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  value={editingLabel}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  style={{ flex: '1 1 220px' }}
                  maxLength={80}
                />
                <button className="button small" onClick={() => saveLabel(item.id)}>
                  Save
                </button>
                <button
                  className="button secondary small"
                  onClick={() => {
                    setEditingId(null);
                    setEditingLabel('');
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <h3 style={{ margin: '0 0 10px' }}>{item.label}</h3>
            )}
            {R2_PUBLIC_URL && (
              <audio controls src={`${R2_PUBLIC_URL}/${item.path}`} style={{ width: '100%' }} />
            )}
            <div className="toolbar" style={{ marginTop: 14 }}>
              <button
                className="button secondary small"
                onClick={() => {
                  setEditingId(item.id);
                  setEditingLabel(item.label);
                }}
              >
                Rename
              </button>
              <button className="button secondary small" onClick={() => remove(item.id)}>
                Delete
              </button>
            </div>
          </div>
        ))
      )}
    </main>
  );
}
