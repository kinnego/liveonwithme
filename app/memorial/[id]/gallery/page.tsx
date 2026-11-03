'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { canEditMemorial } from '@/lib/roles';
import type { Memorial } from '@/lib/types';
import GalleryManager from '@/components/GalleryManager';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function Gallery({ params }: { params: Promise<{ id: string }> }) {
  const [m, setM] = useState<any>();
  const router = useRouter();

  useEffect(() => {
    let stopAuth: (() => void) | undefined;
    params.then(({ id }) => {
      stopAuth = onAuthStateChanged(auth, async (u) => {
        if (!u) {
          router.push('/auth');
          return;
        }
        const snap = await getDoc(doc(db, 'memorials', id));
        if (!snap.exists() || !canEditMemorial(u.uid, snap.data() as Memorial)) {
          return router.push('/dashboard');
        }
        setM({ id: snap.id, ...snap.data() });
      });
    });
    return () => {
      stopAuth?.();
    };
  }, [params, router]);

  if (!m) return <PageSkeleton variant="detail" label="Loading gallery" />;

  return (
    <main className="shell">
      <Link
        href={`/memorial/${m.id}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--sage)',
          fontSize: 14,
          textDecoration: 'none',
          marginBottom: 18,
        }}
      >
        ← Back to {m.fullName.split(' ')[0]}&rsquo;s page
      </Link>
      <div>
        <div className="eyebrow">Photos</div>
        <h2 style={{ marginBottom: 0 }}>{m.fullName}</h2>
      </div>

      <div style={{ marginTop: 20 }}>
        <GalleryManager memorialId={m.id} variant="full" />
      </div>
    </main>
  );
}
