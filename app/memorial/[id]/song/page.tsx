'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { canEditMemorial } from '@/lib/roles';
import type { Memorial } from '@/lib/types';
import { PageSkeleton } from '@/components/Skeleton';
import SongEditor from '@/components/SongEditor';

export const dynamic = 'force-dynamic';

export default function MemorialSongPage({ params }: { params: Promise<{ id: string }> }) {
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
    return () => stopAuth?.();
  }, [params, router]);

  if (!m) return <PageSkeleton variant="detail" label="Loading song" />;

  return (
    <main className="shell">
      <div className="dashboardHead">
        <div>
          <div className="eyebrow">The song</div>
          <h2 style={{ marginBottom: 0 }}>{m.fullName}</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            Paste a YouTube link and visitors can tap a small play button on the memorial. Nothing
            plays automatically.
          </p>
        </div>
        <Link href={`/memorial/${m.id}`} className="button secondary">
          Back
        </Link>
      </div>

      <SongEditor
        memorialId={m.id}
        currentSongUrl={m.songUrl}
        currentSongLabel={m.songLabel}
      />
    </main>
  );
}
