'use client';
// Legacy route — the memorial QR merged into /memorial/[id]/artwork with a
// mode toggle. The old route redirected to the plot QR; the new memorial
// artwork page offers both the memorial-level QR and (via a link) the plot
// artwork so no one loses their way.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
      router.replace(`/memorial/${id}/artwork?mode=qr`);
    });
  }, [params, router]);

  return <PageSkeleton variant="compact" label="Taking you to the artwork page" />;
}
