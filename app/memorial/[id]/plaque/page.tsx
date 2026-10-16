'use client';
// Legacy route — the memorial plaque designer merged into
// /memorial/[id]/artwork with a mode toggle.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

export default function MemorialPlaqueRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();

  useEffect(() => {
    params.then(({ id }) => {
      router.replace(`/memorial/${id}/artwork?mode=plaque`);
    });
  }, [params, router]);

  return <PageSkeleton variant="compact" label="Taking you to the artwork page" />;
}
