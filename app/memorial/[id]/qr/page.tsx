'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { auth, db } from '@/lib/firebase';

export const dynamic = 'force-dynamic';

export default function MemorialQr({ params }: { params: Promise<{ id: string }> }) {
  const [memorial, setMemorial] = useState<any>();
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    params.then(({ id }) => {
      onAuthStateChanged(auth, async (u) => {
        if (!u) return router.push('/auth');
        const snap = await getDoc(doc(db, 'memorials', id));
        if (!snap.exists()) {
          setError('Memorial not found.');
          return;
        }
        const data = snap.data();
        if (data.ownerId !== u.uid) {
          setError('You do not have access to this memorial.');
          return;
        }
        if (data.status !== 'live') {
          setError('The QR code becomes available once the memorial is live.');
          setMemorial({ id: snap.id, ...data });
          return;
        }
        setMemorial({ id: snap.id, ...data });
        const url = `${window.location.origin}/m/${data.slug}`;
        const dataUrl = await QRCode.toDataURL(url, {
          width: 512,
          margin: 2,
          color: { dark: '#25312d', light: '#fffdf9' },
          errorCorrectionLevel: 'H',
        });
        setQrDataUrl(dataUrl);
      });
    });
  }, [params, router]);

  function download() {
    if (!qrDataUrl || !memorial) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `${memorial.slug}-qr.png`;
    a.click();
  }

  if (error) {
    return (
      <main className="shell">
        <div className="formCard center">
          <div className="eyebrow">QR code</div>
          <h2>{memorial ? memorial.fullName : 'Not available'}</h2>
          <p className="muted">{error}</p>
          {memorial && (
            <Link href={`/memorial/${memorial.id}/manage`} className="button" style={{ marginTop: 20 }}>
              Back to manage
            </Link>
          )}
        </div>
      </main>
    );
  }

  if (!memorial || !qrDataUrl) {
    return <main className="shell">Preparing QR code…</main>;
  }

  const publicUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/m/${memorial.slug}`;

  return (
    <main className="shell">
      <div className="formCard center">
        <div className="eyebrow">QR code</div>
        <h2>{memorial.fullName}</h2>
        <p className="muted">
          Print this and place it wherever friends and family might come to remember them.
        </p>
        <div style={{ margin: '30px auto', maxWidth: 320 }}>
          <img
            src={qrDataUrl}
            alt={`QR code for ${memorial.fullName}`}
            style={{ width: '100%', borderRadius: 16, border: '1px solid var(--line)' }}
          />
        </div>
        <p className="muted" style={{ fontSize: 13, wordBreak: 'break-all' }}>
          {publicUrl}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <button className="button" onClick={download}>
            Download PNG
          </button>
          <Link href={`/memorial/${memorial.id}/manage`} className="button secondary">
            Back to manage
          </Link>
        </div>
      </div>
    </main>
  );
}
