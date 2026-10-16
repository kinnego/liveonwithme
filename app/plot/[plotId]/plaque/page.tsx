'use client';
// Legacy route — the plot plaque designer merged into /plot/[plotId]/artwork
// with a mode toggle.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function PlotPlaqueRedirect({
  params,
}: {
  params: Promise<{ plotId: string }>;
}) {
  const router = useRouter();

  useEffect(() => {
    params.then(({ plotId }) => {
      router.replace(`/plot/${plotId}/artwork?mode=plaque`);
    });
  }, [params, router]);

  return <PageSkeleton variant="compact" label="Taking you to the artwork page" />;
}
