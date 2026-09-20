'use client';
// Debounced prefix search over public memorials by fullNameLower. Deliberately
// simple: Firestore doesn't support substring or fuzzy search, so this only
// matches from the start of the person's name (case-insensitive). Results are
// capped at 8 to keep the dropdown scannable.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

type Result = {
  id: string;
  fullName: string;
  nickname?: string;
  born?: string;
  died?: string;
  cemeteryName?: string;
  address?: string;
};

function formatYears(born?: string, died?: string): string {
  const b = born?.slice(0, 4);
  const d = died?.slice(0, 4);
  if (b && d) return `${b} — ${d}`;
  if (b) return `Born ${b}`;
  if (d) return `Died ${d}`;
  return '';
}

export default function MemorialNameSearch() {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'ready' | 'error'>('idle');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = term.trim().toLowerCase();
    if (q.length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }
    if (!db) return;

    let cancelled = false;
    const handle = setTimeout(async () => {
      setStatus('searching');
      try {
        const snap = await getDocs(
          query(
            collection(db!, 'memorials'),
            where('status', '==', 'live'),
            where('visibility', '==', 'public'),
            where('fullNameLower', '>=', q),
            where('fullNameLower', '<=', q + '\uf8ff'),
            orderBy('fullNameLower'),
            fsLimit(8),
          ),
        );
        if (cancelled) return;
        const rows: Result[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            fullName: data.fullName || '',
            nickname: data.nickname || undefined,
            born: data.born,
            died: data.died,
            cemeteryName: data.cemetery?.name,
            address: data.address || undefined,
          };
        });
        setResults(rows);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        console.error('MemorialNameSearch error:', err);
        setStatus('error');
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [term]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const showDropdown =
    open && term.trim().length >= 2 && status !== 'idle';

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <input
        type="search"
        placeholder="Search by name (e.g. Mary O'Donnell)"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        aria-label="Search memorials by name"
        autoComplete="off"
      />
      {showDropdown && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: 'white',
            border: '1px solid var(--line)',
            borderRadius: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
            zIndex: 30,
            overflow: 'hidden',
            textAlign: 'left',
          }}
        >
          {status === 'searching' && (
            <div className="muted" style={{ padding: '14px 16px', fontSize: 14 }}>
              Searching…
            </div>
          )}
          {status === 'ready' && results.length === 0 && (
            <div className="muted" style={{ padding: '14px 16px', fontSize: 14 }}>
              No public memorials match &ldquo;{term.trim()}&rdquo;.
            </div>
          )}
          {status === 'error' && (
            <div className="muted" style={{ padding: '14px 16px', fontSize: 14 }}>
              Search couldn&rsquo;t load. Please try again.
            </div>
          )}
          {status === 'ready' &&
            results.map((r) => {
              const years = formatYears(r.born, r.died);
              const place = r.cemeteryName || r.address;
              return (
                <Link
                  key={r.id}
                  href={`/m/${r.id}`}
                  style={{
                    display: 'block',
                    padding: '12px 16px',
                    borderTop: '1px solid var(--line)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                  onClick={() => setOpen(false)}
                >
                  <div style={{ fontWeight: 600 }}>
                    {r.fullName}
                    {r.nickname && (
                      <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                        ({r.nickname})
                      </span>
                    )}
                  </div>
                  {years && (
                    <div style={{ fontSize: 13, marginTop: 2, color: 'var(--ink, #333)' }}>
                      {years}
                    </div>
                  )}
                  {place && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {place}
                    </div>
                  )}
                </Link>
              );
            })}
        </div>
      )}
    </div>
  );
}
