'use client';
import { FormEvent, useEffect, useState } from 'react';
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
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function Memories({ params }: { params: Promise<{ id: string }> }) {
  const [m, setM] = useState<any>();
  const [items, setItems] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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
            where('source', '==', 'family')
          ),
          (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        );
      })
    );
    return () => stop?.();
  }, [params, router]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!m) return;
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const contributorName = String(fd.get('contributorName') || '').trim();
    const relationship = String(fd.get('relationship') || '').trim();
    const memory = String(fd.get('memory') || '').trim();

    if (!memory || !contributorName) {
      setSaving(false);
      return;
    }

    try {
      if (editingId) {
        await updateDoc(doc(db, 'contributions', editingId), {
          contributorName,
          relationship,
          memory,
        });
        setEditingId(null);
      } else {
        await addDoc(collection(db, 'contributions'), {
          memorialId: m.id,
          contributorName,
          relationship,
          memory,
          photoPath: '',
          caption: '',
          status: 'approved',
          source: 'family',
          createdAt: serverTimestamp(),
        });
      }
      (e.target as HTMLFormElement).reset();
    } finally {
      setSaving(false);
    }
  }

  function startEdit(item: any) {
    setEditingId(item.id);
    setTimeout(() => {
      const form = document.getElementById('memory-form') as HTMLFormElement | null;
      if (!form) return;
      (form.elements.namedItem('contributorName') as HTMLInputElement).value = item.contributorName;
      (form.elements.namedItem('relationship') as HTMLInputElement).value = item.relationship || '';
      (form.elements.namedItem('memory') as HTMLTextAreaElement).value = item.memory;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  async function remove(id: string) {
    if (!confirm('Delete this memory?')) return;
    await deleteDoc(doc(db, 'contributions', id));
    if (editingId === id) setEditingId(null);
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
          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <button className="button" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add memory'}
            </button>
            {editingId && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setEditingId(null);
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
