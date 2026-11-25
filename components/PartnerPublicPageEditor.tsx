'use client';

// Edit overlay for /partner/<slug>?edit=1. Mounts silently for the partner
// who owns the page and for super admins (who use it to curate demo
// accounts); everyone else sees nothing. Saves write straight to the
// target user doc (or /api/partner/slug for slug changes); router.refresh()
// re-renders the server page with new values.

import { useEffect, useRef, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { resizeForMobile } from '@/lib/image';
import { isSuperAdmin } from '@/lib/roles';
import { UserProfile } from '@/lib/types';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';

type Props = {
  uid: string;
  slug: string;
};

export default function PartnerPublicPageEditor({ uid, slug }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editMode = searchParams.get('edit') === '1';

  const [authUid, setAuthUid] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [viewerIsSuperAdmin, setViewerIsSuperAdmin] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [open, setOpen] = useState(false);

  const [slugDraft, setSlugDraft] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [blurb, setBlurb] = useState('');
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');
  const [showPhone, setShowPhone] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [heroPhotoPath, setHeroPhotoPath] = useState('');

  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState('');

  const loaded = useRef(false);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }
    const unsub = auth.onAuthStateChanged(async (u) => {
      setAuthUid(u?.uid || null);
      if (u && db && u.uid !== uid) {
        // Need the viewer's own doc to tell if they're a super admin. Owner
        // editing their own page skips this (their profile load below gives
        // the same answer).
        try {
          const snap = await getDoc(doc(db, 'users', u.uid));
          if (snap.exists()) {
            setViewerIsSuperAdmin(isSuperAdmin(snap.data() as UserProfile));
          }
        } catch {
          // ignore — treated as non-admin
        }
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, [uid]);

  const isOwner = authReady && authUid === uid;
  const canEdit = authReady && authUid !== null && (isOwner || viewerIsSuperAdmin);

  useEffect(() => {
    if (!canEdit || loaded.current || !db) return;
    loaded.current = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (!snap.exists()) return;
        const data = snap.data() as UserProfile;
        setProfile(data);
        setSlugDraft(data.partnerSlug || slug);
        setBusinessName(data.partnerBusinessName || '');
        setBlurb(data.partnerBlurb || '');
        setWebsite(data.partnerWebsite || '');
        setPhone(data.partnerPhone || '');
        setShowPhone(data.partnerShowPhone === true);
        setShowEmail(data.partnerShowEmail === true);
        setHeroPhotoPath(data.partnerHeroPhotoPath || '');
      } catch (err: any) {
        setError(err?.message || 'Could not load your details');
      }
    })();
  }, [canEdit, uid, slug]);

  useEffect(() => {
    if (editMode && canEdit && profile) setOpen(true);
  }, [editMode, canEdit, profile]);

  function closeOverlay() {
    setOpen(false);
    router.replace(`/partner/${slug}`);
  }

  async function uploadHero(file: File) {
    setError('');
    setUploadingPhoto(true);
    try {
      const resized = await resizeForMobile(file);
      const token = await auth?.currentUser?.getIdToken();
      if (!token) throw new Error('Please sign in again.');
      const fd = new FormData();
      fd.append('file', resized);
      fd.append('targetUid', uid);
      const res = await fetch('/api/partner/hero-photo', {
        method: 'POST',
        body: fd,
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      await updateDoc(doc(db, 'users', uid), { partnerHeroPhotoPath: data.path });
      setHeroPhotoPath(data.path);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Could not upload photo');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function clearHero() {
    setError('');
    try {
      await updateDoc(doc(db, 'users', uid), { partnerHeroPhotoPath: '' });
      setHeroPhotoPath('');
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Could not reset photo');
    }
  }

  async function saveDetails() {
    setSaving(true);
    setError('');
    try {
      let activeSlug = slug;
      if (slugDraft && slugDraft !== slug) {
        const token = await auth?.currentUser?.getIdToken();
        if (!token) throw new Error('Please sign in again.');
        const res = await fetch('/api/partner/slug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ targetUid: uid, slug: slugDraft }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not update URL');
        activeSlug = data.slug;
      }
      await updateDoc(doc(db, 'users', uid), {
        partnerBusinessName: businessName.trim(),
        partnerBlurb: blurb.trim(),
        partnerWebsite: website.trim(),
        partnerPhone: phone.trim(),
        partnerShowPhone: showPhone,
        partnerShowEmail: showEmail,
      });
      setSavedAt(Date.now());
      if (activeSlug !== slug) {
        router.replace(`/partner/${activeSlug}?edit=1`);
      } else {
        router.refresh();
      }
    } catch (err: any) {
      setError(err?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  // Floating "Edit page" button for the owner (or super admin) when the
  // overlay is closed. Reuses the memorial-side .editFab style.
  if (canEdit && profile && !editMode) {
    return (
      <a href={`/partner/${slug}?edit=1`} className="editFab">
        Edit page
      </a>
    );
  }

  if (!editMode || !canEdit || !profile || !open) return null;

  return (
    <>
      <div className="editOverlayScrim" onClick={closeOverlay} aria-hidden="true" />
      <aside className="editOverlayPanel" role="dialog" aria-label="Edit your public page">
        <div className="editOverlayHead">
          <div>
            <div className="eyebrow">Your public page</div>
            <h3 style={{ margin: '4px 0 0' }}>Edit</h3>
          </div>
          <button
            type="button"
            className="button secondary small"
            onClick={closeOverlay}
          >
            Done
          </button>
        </div>

        <div className="editOverlayBody">
          <div className="fieldStack">
            <div>
              <label>Hero photo</label>
              <div className="partnerHeroPhotoEditor">
                {heroPhotoPath && R2_PUBLIC_URL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`${R2_PUBLIC_URL}/${heroPhotoPath}`}
                    alt=""
                    className="partnerHeroPhotoPreview"
                  />
                ) : (
                  <div className="partnerHeroPhotoPlaceholder">
                    <span className="muted" style={{ fontSize: 13 }}>
                      Using a default photo until you upload one.
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <label className="button secondary small" style={{ cursor: 'pointer' }}>
                    {uploadingPhoto ? 'Uploading…' : heroPhotoPath ? 'Replace photo' : 'Upload photo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      disabled={uploadingPhoto}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadHero(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {heroPhotoPath && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={clearHero}
                      disabled={uploadingPhoto}
                    >
                      Use default
                    </button>
                  )}
                </div>
              </div>
              <span className="muted" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
                A warm, high-resolution photograph works best — your shopfront, chapel,
                a floral arrangement, or a candid team portrait.
              </span>
            </div>

            <div>
              <label htmlFor="editorSlug">Your URL</label>
              <div className="slugPreview">
                <span className="slugHost">/partner/</span>
                <input
                  id="editorSlug"
                  type="text"
                  value={slugDraft}
                  onChange={(e) => setSlugDraft(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  placeholder="your-firm-name"
                />
              </div>
              <span className="muted" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
                Lowercase letters, numbers, and hyphens.
              </span>
            </div>

            <div>
              <label htmlFor="editorBusinessName">Business name</label>
              <input
                id="editorBusinessName"
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="How families see you"
              />
            </div>

            <div>
              <label htmlFor="editorBlurb">Short intro</label>
              <textarea
                id="editorBlurb"
                value={blurb}
                onChange={(e) => setBlurb(e.target.value)}
                rows={3}
                maxLength={400}
                placeholder="A sentence or two about what you do and the families you serve."
                style={{ minHeight: 90 }}
              />
              <span className="muted" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                {blurb.length}/400
              </span>
            </div>

            <div>
              <label htmlFor="editorWebsite">Website</label>
              <input
                id="editorWebsite"
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://..."
              />
            </div>

            <div>
              <label htmlFor="editorPhone">Phone</label>
              <input
                id="editorPhone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Only shown if the switch below is on"
              />
            </div>

            <div className="toggleRow">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showPhone}
                  onChange={(e) => setShowPhone(e.target.checked)}
                  disabled={!phone}
                />
                <span className="toggleTrack" aria-hidden="true" />
                <span className="toggleCopy">
                  <span>Show phone on your public page</span>
                  <span className="toggleHint">
                    {phone ? phone : 'Add a number above to enable this.'}
                  </span>
                </span>
              </label>
            </div>

            <div className="toggleRow">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showEmail}
                  onChange={(e) => setShowEmail(e.target.checked)}
                />
                <span className="toggleTrack" aria-hidden="true" />
                <span className="toggleCopy">
                  <span>Show email on your public page</span>
                  <span className="toggleHint">
                    {profile.email || 'Your account email'}
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="editOverlayFoot">
          <button
            type="button"
            className="button"
            onClick={saveDetails}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {savedAt && !saving && (
            <span className="muted" style={{ fontSize: 13 }}>Saved.</span>
          )}
          {error && (
            <span style={{ color: '#b00020', fontSize: 14 }}>{error}</span>
          )}
        </div>
      </aside>
    </>
  );
}
