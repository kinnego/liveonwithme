'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { isSuperAdmin } from '@/lib/roles';
import type { UserProfile } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/Skeleton';

export const dynamic = 'force-dynamic';

type Target = 'memorials' | 'contributions';

interface BatchResult {
  ok: boolean;
  target: Target;
  scanned: number;
  updated: number;
  skipped: number;
  failed: number;
  nextCursor: string | null;
  done: boolean;
  dryRun: boolean;
  results: Array<{ id: string; status: string; detail?: string }>;
}

export default function BackfillVariantsPage() {
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [totals, setTotals] = useState({ scanned: 0, updated: 0, skipped: 0, failed: 0 });
  const stopRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return router.push('/auth');
      const snap = await getDoc(doc(db, 'users', u.uid));
      const prof = snap.exists() ? (snap.data() as UserProfile) : null;
      setState(isSuperAdmin(prof) ? 'ok' : 'denied');
    });
  }, [router]);

  function appendLog(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function runBatch(target: Target, cursor: string | null, dryRun: boolean): Promise<BatchResult> {
    const token = await auth.currentUser?.getIdToken();
    const params = new URLSearchParams({ target, limit: '20' });
    if (cursor) params.set('cursor', cursor);
    if (dryRun) params.set('dryRun', '1');
    const res = await fetch(`/api/admin/backfill-variants?${params.toString()}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = (await res.json()) as BatchResult | { error: string };
    if (!res.ok) throw new Error((data as any).error || 'Backfill failed');
    return data as BatchResult;
  }

  async function runAll(dryRun: boolean) {
    if (running) return;
    setRunning(true);
    setLog([]);
    setTotals({ scanned: 0, updated: 0, skipped: 0, failed: 0 });
    stopRef.current = false;
    try {
      for (const target of ['memorials', 'contributions'] as Target[]) {
        appendLog(`→ ${target}${dryRun ? ' (dry run)' : ''}`);
        let cursor: string | null = null;
        while (!stopRef.current) {
          const result = await runBatch(target, cursor, dryRun);
          setTotals((t) => ({
            scanned: t.scanned + result.scanned,
            updated: t.updated + result.updated,
            skipped: t.skipped + result.skipped,
            failed: t.failed + result.failed,
          }));
          appendLog(
            `  batch: scanned ${result.scanned}, updated ${result.updated}, skipped ${result.skipped}, failed ${result.failed}`,
          );
          for (const r of result.results) {
            if (r.status !== 'already_done' && r.status !== 'no_path') {
              appendLog(`    ${r.id} — ${r.status}${r.detail ? ` (${r.detail})` : ''}`);
            }
          }
          if (result.done) {
            appendLog(`  ${target}: done`);
            break;
          }
          cursor = result.nextCursor;
        }
      }
      appendLog(stopRef.current ? '✕ stopped' : '✓ complete');
    } catch (err: any) {
      appendLog(`error: ${err.message || err}`);
    } finally {
      setRunning(false);
    }
  }

  if (state === 'checking') return <PageSkeleton variant="default" label="Checking access" />;
  if (state === 'denied') {
    return (
      <main className="shell">
        <div className="card">
          <h3>Not authorised.</h3>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin" style={{ color: 'var(--muted)' }}>
          ← Admin
        </Link>
      </div>
      <div className="eyebrow">Admin</div>
      <h2 style={{ marginTop: 6 }}>Image variants backfill</h2>
      <p className="muted" style={{ maxWidth: 640 }}>
        Walks every memorial hero and every contribution photo. For each one that doesn&rsquo;t yet have
        the <code>.400.webp</code>/<code>.800.webp</code> siblings, downloads the original from R2,
        regenerates variants, and flips the flag on the Firestore doc so the public page serves the
        resized versions. Safe to re-run — already-flagged docs are skipped.
      </p>

      <div className="toolbar" style={{ marginTop: 20 }}>
        <button
          type="button"
          className="button secondary"
          disabled={running}
          onClick={() => runAll(true)}
        >
          Dry run
        </button>
        <button
          type="button"
          className="button"
          disabled={running}
          onClick={() => runAll(false)}
        >
          {running ? 'Running…' : 'Run backfill'}
        </button>
        {running && (
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              stopRef.current = true;
            }}
          >
            Stop
          </button>
        )}
      </div>

      <div style={{ marginTop: 24, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Stat label="Scanned" value={totals.scanned} />
        <Stat label="Updated" value={totals.updated} />
        <Stat label="Skipped" value={totals.skipped} />
        <Stat label="Failed" value={totals.failed} />
      </div>

      <pre
        style={{
          marginTop: 20,
          background: '#1b2420',
          color: '#e8e1d7',
          padding: 16,
          borderRadius: 12,
          fontSize: 13,
          minHeight: 240,
          maxHeight: 500,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
        }}
      >
        {log.length ? log.join('\n') : '(no activity yet)'}
      </pre>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        background: 'var(--paper)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: '12px 18px',
        minWidth: 110,
      }}
    >
      <div className="eyebrow">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
