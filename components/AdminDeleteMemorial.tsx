'use client';
// Super admin: delete a memorial for good, right now. Type the name to confirm.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';

export default function AdminDeleteMemorial({ memorialId, fullName }: { memorialId: string; fullName: string }) {
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
      const res = await fetch(`/api/admin/memorials/${encodeURIComponent(memorialId)}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ confirmName: typed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Delete failed.');
      router.push('/admin/memorials');
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 30, borderColor: '#e6c9c5' }}>
      <h3 style={{ marginTop: 0 }}>Delete this memorial</h3>
      {!open ? (
        <button type="button" className="button secondary" onClick={() => setOpen(true)}>
          Delete this memorial…
        </button>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            This deletes the memorial now, with every memory, photo and recording on it. It can&rsquo;t be
            undone, and the keeper isn&rsquo;t told automatically.
          </p>
          <label htmlFor="admin-delete-name" style={{ display: 'block', fontWeight: 600 }}>
            Type the name to confirm: <span style={{ fontWeight: 700 }}>{fullName}</span>
          </label>
          <input id="admin-delete-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" style={{ marginTop: 6 }} />
          {error && <p style={{ color: '#a94442', fontSize: 14 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <button
              type="button"
              className="button"
              style={{ background: '#a94442', borderColor: '#a94442' }}
              disabled={busy || !typed.trim()}
              onClick={remove}
            >
              {busy ? 'Deleting…' : 'Delete for good'}
            </button>
            <button type="button" className="button secondary" disabled={busy} onClick={() => { setOpen(false); setTyped(''); setError(''); }}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
