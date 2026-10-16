'use client';
// Legacy route — the plot QR designer merged into /plot/[plotId]/artwork with
// a mode toggle. Any printed material still pointing here forwards there.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function PlotQrRedirect({
  params,
}: {
  params: Promise<{ plotId: string }>;
}) {
  const router = useRouter();

  useEffect(() => {
    params.then(({ plotId }) => {
      router.replace(`/plot/${plotId}/artwork?mode=qr`);
    });
  }, [params, router]);

  return <PageSkeleton variant="compact" label="Taking you to the artwork page" />;
}
