'use client';
// The graveyards the signed-in person keeps the register for. One person can
// look after several (a parish often has more than one graveyard), and each
// graveyard can have several registrars. Renders nothing for anyone else.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import type { Cemetery } from '@/lib/types';

export default function MyGraveyards({ currentPlaceId, title = 'Your graveyards' }: { currentPlaceId?: string; title?: string }) {
  const [list, setList] = useState<Cemetery[]>([]);

  useEffect(() => {
    // auth is null when Firebase isn't configured (e.g. a local build).
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
        if (!u) return setList([]);
        try {
          const token = await u.getIdToken();
          const res = await fetch('/api/registrar', { headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json().catch(() => ({}));
          setList(Array.isArray(data.cemeteries) ? data.cemeteries.filter(Boolean) : []);
        } catch {
          setList([]);
        }
      });
  }, []);

  const others = list.filter((c) => c.placeId !== currentPlaceId);
  if (others.length === 0) return null;

  return (
    <div className="card" style={{ textAlign: 'left', margin: '0 0 20px' }}>
      <div className="fieldLabel" style={{ marginTop: 0 }}>{title}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {others.map((c) => (
          <li key={c.placeId}>
            <Link
              href={`/cemetery/${encodeURIComponent(c.placeId)}/registrar?name=${encodeURIComponent(c.name)}`}
              style={{ textDecoration: 'underline' }}
            >
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
