'use client';
// Small card on the manage page for adding/changing the memorial's song.
// Duplicates the input on the /edit page on purpose: families visit the
// manage page far more often than the edit page, and swapping a song
// shouldn't feel like "editing the memorial" (heavy) — it should feel like
// a small touch (light).

import { FormEvent, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DEFAULT_SONG_LABEL, parseYoutubeVideoId } from '@/lib/song';

type Props = {
  memorialId: string;
  currentSongUrl?: string;
  currentSongLabel?: string;
};

export default function SongEditor({ memorialId, currentSongUrl, currentSongLabel }: Props) {
  const [url, setUrl] = useState(currentSongUrl || '');
  const [label, setLabel] = useState(currentSongLabel || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmedUrl = url.trim();
    const trimmedLabel = label.trim();
    if (trimmedUrl && !parseYoutubeVideoId(trimmedUrl)) {
      setError('That does not look like a valid YouTube link. Paste the full URL from the YouTube page.');
      return;
    }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await updateDoc(doc(db, 'memorials', memorialId), {
        songUrl: trimmedUrl,
        songLabel: trimmedLabel,
        updatedAt: serverTimestamp(),
      });
      setSaved(true);
    } catch (err: any) {
      setError(err?.message || 'Could not save the song.');
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!confirm('Remove the song? The Play button will disappear from the page.')) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await updateDoc(doc(db, 'memorials', memorialId), {
        songUrl: '',
        songLabel: '',
        updatedAt: serverTimestamp(),
      });
      setUrl('');
      setLabel('');
      setSaved(true);
    } catch (err: any) {
      setError(err?.message || 'Could not remove the song.');
    } finally {
      setSaving(false);
    }
  }

  const hasSong = Boolean(currentSongUrl && parseYoutubeVideoId(currentSongUrl));
  const previewLabel = label.trim() || DEFAULT_SONG_LABEL;

  return (
    <div className="card" style={{ marginTop: 30, marginBottom: 30 }}>
      <div className="eyebrow">Their song</div>
      <h3 style={{ marginTop: 10 }}>
        {hasSong ? 'A song is set' : 'Add a song visitors can play'}
      </h3>
      <p className="muted">
        {hasSong
          ? `Visitors see a small "${previewLabel}" button on the page. Nothing plays automatically.`
          : 'Paste a YouTube link and visitors can tap play to hear it. Nothing plays automatically.'}
      </p>

      <form onSubmit={submit} style={{ marginTop: 6 }}>
        <label htmlFor="song-url">YouTube link</label>
        <input
          id="song-url"
          name="song-url"
          type="url"
          inputMode="url"
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setSaved(false);
            setError('');
          }}
        />

        <label htmlFor="song-label">Button text (optional)</label>
        <input
          id="song-label"
          name="song-label"
          type="text"
          maxLength={80}
          placeholder={DEFAULT_SONG_LABEL}
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setSaved(false);
            setError('');
          }}
        />
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Leave blank to use the default: &ldquo;{DEFAULT_SONG_LABEL}&rdquo;.
        </p>

        {error && <p style={{ color: '#a94442', marginTop: 12, fontSize: 14 }}>{error}</p>}
        {saved && !error && (
          <p style={{ color: '#2f5b48', marginTop: 12, fontSize: 14 }}>Saved.</p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button type="submit" className="button" disabled={saving}>
            {saving ? 'Saving…' : hasSong ? 'Update song' : 'Save song'}
          </button>
          {hasSong && (
            <button
              type="button"
              className="button secondary"
              onClick={clear}
              disabled={saving}
            >
              Remove song
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
