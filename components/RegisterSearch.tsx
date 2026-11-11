'use client';
// "Find someone here" on a cemetery's page, which is where the cemetery's
// QR poster lands. Memorial pages come first (the family's own page), then
// graves from the parish burial register, which open the grave's page with
// its row, plot and directions. Shows when there is anything to search.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { matchBurialForTerms, searchTerms } from '@/lib/grave-match';

type MemorialLite = { id: string; slug?: string; fullName: string; nickname?: string; died?: string };

type Hit = { id: string; name: string; nickname?: string; died?: string; age?: string; label: string; hasPin: boolean; others: number };

export default function RegisterSearch({
  placeId,
  cemeteryName,
  memorials,
}: {
  placeId: string;
  cemeteryName: string;
  memorials: MemorialLite[] | null;
}) {
  const [count, setCount] = useState(0);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/graves/search?placeId=${encodeURIComponent(placeId)}`)
      .then((r) => r.json())
      .then((d) => setCount(Number(d.count) || 0))
      .catch(() => setCount(0));
  }, [placeId]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3 || count === 0) {
      setHits(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/graves/search?placeId=${encodeURIComponent(placeId)}&q=${encodeURIComponent(term)}`);
        const d = await r.json().catch(() => ({}));
        if (!cancelled) setHits(Array.isArray(d.results) ? d.results : []);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, placeId, count]);

  const memorialCount = memorials?.length || 0;
  if (count === 0 && memorialCount === 0) return null;

  // Memorials at this cemetery are already loaded on the page; match them here.
  const terms = q.trim().length >= 2 ? searchTerms(q) : [];
  const memorialHits = terms.length
    ? (memorials || []).filter((m) => {
        const words = (m.fullName || '').trim().split(/\s+/);
        const surname = words.pop() || '';
        return matchBurialForTerms([{ surname, forenames: words.join(' '), nickname: m.nickname || '' }], terms) === 0;
      })
    : [];
  // Families' memorials replace the register entry for the same grave.
  const graveHits = hits || [];
  const nothing = hits !== null && !busy && graveHits.length === 0 && memorialHits.length === 0;

  return (
    <div className="card" style={{ maxWidth: 620, margin: '0 auto 30px' }}>
      <div className="eyebrow">Find someone</div>
      <h3 style={{ margin: '8px 0 6px' }}>Who are you looking for at {cemeteryName}?</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 15 }}>
        Type a name to find their memorial page
        {count > 0 && <>, or where they&rsquo;re buried from the parish burial register</>}.
      </p>
      <input
        type="search"
        placeholder="e.g. Bridget O’Donnell"
        aria-label="Name to search for in the burial register"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoComplete="off"
      />
      {busy && hits === null && <p className="muted" style={{ fontSize: 14 }}>Searching…</p>}
      {nothing && (
        <p className="muted" style={{ fontSize: 14 }}>No one by that name here yet. Try just the surname.</p>
      )}
      {memorialHits.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
          {memorialHits.slice(0, 8).map((m) => (
            <li key={m.id}>
              <Link
                href={`/m/${m.slug || m.id}`}
                style={{ display: 'block', padding: '12px 14px', border: '1px solid var(--sage)', borderRadius: 12, background: 'white' }}
              >
                <div style={{ fontWeight: 650 }}>
                  {m.fullName}
                  {m.nickname && <span className="muted" style={{ fontWeight: 400 }}> ({m.nickname})</span>}
                </div>
                <div className="muted" style={{ fontSize: 14 }}>
                  {[m.died && `Died ${m.died.slice(0, 4)}`, 'Memorial page'].filter(Boolean).join(' · ')}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {graveHits.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
          {graveHits.map((h) => (
            <li key={h.id}>
              <Link
                href={`/grave/${h.id}`}
                style={{ display: 'block', padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 12, background: 'white' }}
              >
                <div style={{ fontWeight: 650 }}>
                  {h.name}
                  {h.nickname && <span className="muted" style={{ fontWeight: 400 }}> ({h.nickname})</span>}
                </div>
                <div className="muted" style={{ fontSize: 14 }}>
                  {[h.died && `Died ${h.died}`, h.age && `aged ${h.age}`, h.label, h.hasPin && '📍 on the map', h.others > 0 && `${h.others} more in this grave`, 'Burial register']
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
