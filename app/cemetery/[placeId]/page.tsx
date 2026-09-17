'use client';
import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import CemeterySearch from '@/components/CemeterySearch';

export const dynamic = 'force-dynamic';

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

type Memorial = {
  id: string;
  slug: string;
  fullName: string;
  born?: string;
  died?: string;
  heroPhotoPath?: string;
  cemetery?: { name?: string; address?: string; placeId?: string };
};

export default function CemeteryPage({
  params,
  searchParams,
}: {
  params: Promise<{ placeId: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const { placeId } = use(params);
  const sp = use(searchParams);
  const [memorials, setMemorials] = useState<Memorial[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        if (!db) throw new Error('Firestore not available');
        const snap = await getDocs(
          query(
            collection(db, 'memorials'),
            where('cemetery.placeId', '==', placeId),
            where('status', '==', 'live'),
            where('visibility', '==', 'public')
          )
        );
        setMemorials(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Memorial)));
      } catch (err: any) {
        console.error('Cemetery query failed:', err);
        setError(
          err?.code === 'failed-precondition'
            ? 'Search is warming up — please try again in a moment.'
            : 'Something went wrong loading this cemetery.'
        );
        setMemorials([]);
      }
    })();
  }, [placeId]);

  const cemeteryName =
    memorials?.[0]?.cemetery?.name || sp.name || 'This cemetery';
  const cemeteryAddress = memorials?.[0]?.cemetery?.address;

  return (
    <main className="shell">
      <div className="eyebrow">Find someone</div>
      <h1 style={{ marginBottom: 8 }}>{cemeteryName}</h1>
      {cemeteryAddress && (
        <p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>
          {cemeteryAddress}
        </p>
      )}

      <div style={{ maxWidth: 520, marginBottom: 40 }}>
        <label className="fieldLabel" htmlFor="cemetery-search">
          Search a different cemetery
        </label>
        <CemeterySearch />
      </div>

      {memorials === null && <p className="muted">Looking for memorials…</p>}

      {error && (
        <div className="card" style={{ marginBottom: 20 }}>
          <p className="muted" style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      {memorials && memorials.length === 0 && !error && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>No public memorials listed here yet</h3>
          <p className="muted">
            When families choose to make their loved one&rsquo;s memorial public and link it to
            this cemetery, it will appear here.
          </p>
        </div>
      )}

      {memorials && memorials.length > 0 && (
        <>
          <p className="muted" style={{ marginBottom: 18 }}>
            {memorials.length} memorial{memorials.length === 1 ? '' : 's'} at this cemetery
          </p>
          <div className="cemeteryList">
            {memorials.map((m) => {
              const years = `${m.born?.slice(0, 4) || ''} — ${m.died?.slice(0, 4) || ''}`;
              const hero = m.heroPhotoPath ? `${R2_PUBLIC_URL}/${m.heroPhotoPath}` : '';
              return (
                <Link
                  key={m.id}
                  href={`/m/${m.slug}`}
                  className="cemeteryCard"
                  style={{ display: 'block' }}
                >
                  <div
                    className="cemeteryHero"
                    style={
                      hero
                        ? {
                            backgroundImage: `linear-gradient(rgba(22,30,27,.08),rgba(22,30,27,.4)),url(${hero})`,
                          }
                        : {}
                    }
                  />
                  <div style={{ padding: '18px 20px' }}>
                    <h3 style={{ margin: 0, fontSize: 22 }}>{m.fullName}</h3>
                    <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
                      {years}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <p className="muted" style={{ marginTop: 60, fontSize: 13, textAlign: 'center' }}>
        Only memorials that families have chosen to make public appear here.
      </p>
    </main>
  );
}
