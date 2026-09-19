'use client';
// Legacy route — QR codes now live at the plot level. If this memorial is
// already linked to a plot, take the user straight there; otherwise send them
// to Manage where they can create/link the plot with a friendly explanation.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function MemorialQrRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();

  useEffect(() => {
    params.then(({ id }) => {
      if (!auth) return;
      return onAuthStateChanged(auth, async (u) => {
        if (!u) return router.push('/auth');
        const snap = await getDoc(doc(db, 'memorials', id));
        if (!snap.exists()) return router.push('/dashboard');
        const data = snap.data() as any;
        if (data.plotId) {
          router.replace(`/plot/${data.plotId}/qr`);
        } else {
          router.replace(`/memorial/${id}/manage`);
        }
      });
    });
  }, [params, router]);

  return <PageSkeleton variant="compact" label="Taking you to the QR code" />;
}
