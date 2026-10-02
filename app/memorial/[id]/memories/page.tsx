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
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { canEditMemorial } from '@/lib/roles';
import type { Memorial } from '@/lib/types';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

async function uploadToR2(file: File, path: string, memorialId: string) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', path);
  formData.append('memorialId', memorialId);
  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data as { path: string; sizeBytes: number };
}

export default function Memories({ params }: { params: Promise<{ id: string }> }) {
  const [m, setM] = useState<any>();
  const [items, setItems] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const editingId = editingItem?.id ?? null;
  const editingHasAudio = Boolean(editingItem?.audioPath);

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
          query(
            collection(db, 'contributions'),
            where('memorialId', '==', id),
            where('source', '==', 'family')
          ),
          (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() })))
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
    setUploadError('');
    const fd = new FormData(e.currentTarget);
    const contributorName = String(fd.get('contributorName') || '').trim();
    const relationship = String(fd.get('relationship') || '').trim();
    const memory = String(fd.get('memory') || '').trim();
    const audioFile = fd.get('audio') as File | null;
    const removeAudio = fd.get('removeAudio') === 'on';

    if (!memory || !contributorName) {
      setSaving(false);
      return;
    }

    try {
      let newAudioPath: string | null = null;
      let newAudioMimeType: string | null = null;
      if (audioFile && audioFile.size > 0) {
        const safeName = audioFile.name.replace(/[^\w.-]+/g, '_');
        const path = `contributions/${m.id}/${crypto.randomUUID()}-${safeName}`;
        const uploaded = await uploadToR2(audioFile, path, m.id);
        newAudioPath = uploaded.path;
        newAudioMimeType = audioFile.type || 'audio/mpeg';
      }

      if (editingId) {
        const update: Record<string, unknown> = {
          contributorName,
          relationship,
          memory,
        };
        if (newAudioPath) {
          update.audioPath = newAudioPath;
          update.audioMimeType = newAudioMimeType;
        } else if (removeAudio) {
          update.audioPath = '';
          update.audioMimeType = '';
        }
        await updateDoc(doc(db, 'contributions', editingId), update);
        setEditingItem(null);
      } else {
        const docData: Record<string, unknown> = {
          memorialId: m.id,
          contributorName,
          relationship,
          memory,
          photoPath: '',
          caption: '',
          status: 'approved',
          source: 'family',
          createdAt: serverTimestamp(),
        };
        if (newAudioPath) {
          docData.audioPath = newAudioPath;
          docData.audioMimeType = newAudioMimeType;
        }
        await addDoc(collection(db, 'contributions'), docData);
      }
      (e.target as HTMLFormElement).reset();
    } catch (err: any) {
      setUploadError(err?.message || 'Something went wrong saving the memory.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(item: any) {
    setEditingItem(item);
    setUploadError('');
    setTimeout(() => {
      const form = document.getElementById('memory-form') as HTMLFormElement | null;
      if (!form) return;
      (form.elements.namedItem('contributorName') as HTMLInputElement).value = item.contributorName;
      (form.elements.namedItem('relationship') as HTMLInputElement).value = item.relationship || '';
      (form.elements.namedItem('memory') as HTMLTextAreaElement).value = item.memory;
      if (audioInputRef.current) audioInputRef.current.value = '';
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  async function remove(id: string) {
    if (!confirm('Delete this memory?')) return;
    await deleteDoc(doc(db, 'contributions', id));
    if (editingId === id) setEditingItem(null);
  }

  if (!m) return <PageSkeleton variant="detail" label="Loading memories" />;

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">Memories written by the family</div>
          <h2 style={{ marginBottom: 0 }}>{m.fullName}</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            These appear in the &ldquo;In their words&rdquo; section of the memorial. Family
            memories are always visible.
          </p>
        </div>
        <Link href={`/memorial/${m.id}/manage`} className="button secondary">
          Back to manage
        </Link>
      </div>

      <div className="formCard" style={{ margin: '20px 0' }}>
        <h3 style={{ marginTop: 0 }}>
          {editingId ? 'Edit memory' : 'Write a new memory'}
        </h3>
        <form id="memory-form" onSubmit={submit}>
          <div className="twoCol">
            <div>
              <label>Whose memory is this?</label>
              <input
                name="contributorName"
                placeholder="e.g. Mary O&rsquo;Donnell"
                required
              />
            </div>
            <div>
              <label>How did you know them?</label>
              <input name="relationship" placeholder="Son, daughter, wife…" />
            </div>
          </div>
          <label>The memory</label>
          <textarea
            name="memory"
            required
            placeholder="A story, a small moment, something they used to say…"
          />

          <label style={{ marginTop: 18 }}>
            {editingHasAudio ? 'Replace the voice note (optional)' : 'Add a voice note (optional)'}
          </label>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Upload a short recording — a voicemail they left, a message you want remembered, a
            birthday song. MP3, M4A or similar; up to 50&nbsp;MB.
          </p>
          <input
            ref={audioInputRef}
            name="audio"
            type="file"
            accept="audio/*"
          />

          {editingHasAudio && R2_PUBLIC_URL && (
            <div style={{ marginTop: 12 }}>
              <p className="muted" style={{ margin: '0 0 6px', fontSize: 13 }}>
                Current voice note:
              </p>
              <audio controls src={`${R2_PUBLIC_URL}/${editingItem.audioPath}`} style={{ width: '100%' }} />
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 14 }}>
                <input name="removeAudio" type="checkbox" style={{ width: 'auto' }} />
                Remove the current voice note on save
              </label>
            </div>
          )}

          {uploadError && (
            <p style={{ color: '#a94442', marginTop: 14, fontSize: 14 }}>{uploadError}</p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <button className="button" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add memory'}
            </button>
            {editingId && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setEditingItem(null);
                  setUploadError('');
                  (document.getElementById('memory-form') as HTMLFormElement)?.reset();
                }}
              >
                Cancel edit
              </button>
            )}
          </div>
        </form>
      </div>

      {items.length === 0 ? (
        <div className="card">
          <p className="muted">No family memories yet. The first one you add above will appear here.</p>
        </div>
      ) : (
        items.map((item) => (
          <div className="card" key={item.id} style={{ marginBottom: 12 }}>
            <div className="quote" style={{ fontSize: 22, margin: '0 0 12px' }}>
              &ldquo;{item.memory}&rdquo;
            </div>
            {item.audioPath && R2_PUBLIC_URL && (
              <audio
                controls
                src={`${R2_PUBLIC_URL}/${item.audioPath}`}
                style={{ width: '100%', marginBottom: 12 }}
              />
            )}
            <p className="muted" style={{ margin: 0 }}>
              — {item.contributorName}
              {item.relationship ? `, ${item.relationship}` : ''}
            </p>
            <div className="toolbar" style={{ marginTop: 14 }}>
              <button className="button secondary small" onClick={() => startEdit(item)}>
                Edit
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
