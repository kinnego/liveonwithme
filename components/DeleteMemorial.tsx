'use client';
// "Delete this memorial", for the memorial's keeper. Folded away at the
// bottom of the manage page, and they type the person's name to confirm.
// The memorial goes offline at once and can be restored from the
// dashboard for 30 days.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';

export default function DeleteMemorial({ memorialId, fullName, word }: { memorialId: string; fullName: string; word: 'memorial' | 'page' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setBusy(true);
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/memorial/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ memorialId, confirmName: typed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not delete it. Please try again.');
      router.push('/dashboard?deleted=1');
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 30, borderColor: '#e6c9c5' }}>
      <h3 style={{ marginTop: 0 }}>Delete this {word}</h3>
      {!open ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Removes the {word} for everyone, with its memories and photos. You&rsquo;ll have 30 days to
            change your mind.
          </p>
          <button type="button" className="button secondary" onClick={() => setOpen(true)}>
            Delete this {word}…
          </button>
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            Once you delete it, nobody will be able to see the {word}. It stays in your dashboard for{' '}
            <strong>30 days</strong>, where you can restore it. After that it, and every memory and
            photo on it, is gone for good.
          </p>
          <label htmlFor="confirm-delete-name" style={{ display: 'block', fontWeight: 600 }}>
            To confirm, type the name: <span style={{ fontWeight: 700 }}>{fullName}</span>
          </label>
          <input
            id="confirm-delete-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            style={{ marginTop: 6 }}
          />
          {error && <p style={{ color: '#a94442', fontSize: 14 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <button
              type="button"
              className="button"
              style={{ background: '#a94442', borderColor: '#a94442' }}
              disabled={busy || !typed.trim()}
              onClick={remove}
            >
              {busy ? 'Deleting…' : `Delete the ${word}`}
            </button>
            <button type="button" className="button secondary" disabled={busy} onClick={() => { setOpen(false); setTyped(''); setError(''); }}>
              Keep it
            </button>
          </div>
        </>
      )}
    </div>
  );
}
