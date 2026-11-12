'use client';
// A grave's headstone photo on the registrar's list: a small picture, and
// one button to take or choose a photo. On a phone the button offers the
// camera, so a registrar walking the graveyard can snap each headstone.

import { useRef, useState } from 'react';
import { auth } from '@/lib/firebase';
import { shrinkImage } from '@/lib/shrink-image';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

export function headstoneUrl(path: string | null | undefined): string | null {
  return path && R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${path}` : null;
}

export default function HeadstonePhoto({
  graveId,
  photoPath,
  personName,
  onChange,
}: {
  graveId: string;
  photoPath: string | null;
  /** First name of the first person in the grave, for the button. */
  personName?: string;
  onChange: (path: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = headstoneUrl(photoPath);

  async function call(method: 'POST' | 'DELETE', body?: FormData) {
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch(`/api/grave-records/${encodeURIComponent(graveId)}/photo`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'The photo didn’t save. Please try again.');
    return data as { photoPath?: string };
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const small = await shrinkImage(file);
      const fd = new FormData();
      fd.append('file', small, 'headstone.jpg');
      const { photoPath: path } = await call('POST', fd);
      onChange(path || null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await call('DELETE');
      onChange(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open the headstone photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Headstone" width={64} height={64} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
        </a>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <button type="button" className="button secondary small" disabled={busy} onClick={() => input.current?.click()}>
        {busy
          ? 'Saving the photo…'
          : url
            ? 'Change the photo'
            : `📷 Add a photo of ${personName ? `${personName}\u2019s` : 'the'} grave`}
      </button>
      {url && !busy && (
        <button
          type="button"
          onClick={remove}
          style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', fontSize: 14 }}
        >
          Remove
        </button>
      )}
      {error && <div style={{ color: '#a94442', fontSize: 13, flexBasis: '100%' }}>{error}</div>}
    </div>
  );
}
