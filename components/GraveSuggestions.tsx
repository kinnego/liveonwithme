'use client';
// "Could this be the grave?" — shown when a family picks a cemetery for a
// memorial. Matches come from the cemetery's burial register (kept by its
// registrars). Nothing happens unless the family taps yes:
//   - an unclaimed grave is adopted: it becomes their plot, pin and all;
//   - a grave another relative already adopted gets an "ask to join"
//     request through the normal plot membership flow.

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { attachMemorialToExistingPlot } from '@/lib/plot';
import type { Cemetery } from '@/lib/types';

export type GraveSuggestion = {
  id: string;
  label: string;
  matchedIndex: number;
  burials: { name: string; died: string; age: string; nickname?: string; relations?: string; address?: string }[];
  inscription: string;
  hasPin: boolean;
  adopted: boolean;
  plotId: string | null;
};

async function authedPost<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Fetch suggestions without rendering anything. Never throws. */
export async function fetchGraveSuggestions(memorialId: string, placeId: string): Promise<GraveSuggestion[]> {
  try {
    const { ok, data } = await authedPost<{ suggestions: GraveSuggestion[] }>('/api/grave-records/suggest', {
      memorialId,
      placeId,
    });
    return ok && Array.isArray(data.suggestions) ? data.suggestions : [];
  } catch {
    return [];
  }
}

type Props = {
  memorialId: string;
  personId?: string;
  cemetery: Cemetery;
  onLoaded?: (count: number) => void;
  onAdopted: (plotId: string) => void;
  onJoinRequested: () => void;
};

export default function GraveSuggestions({ memorialId, personId, cemetery, onLoaded, onAdopted, onJoinRequested }: Props) {
  const [suggestions, setSuggestions] = useState<GraveSuggestion[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportText, setReportText] = useState('');
  const [reported, setReported] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setSuggestions(null);
    fetchGraveSuggestions(memorialId, cemetery.placeId).then((s) => {
      if (cancelled) return;
      setSuggestions(s);
      onLoaded?.(s.length);
    });
    return () => {
      cancelled = true;
    };
    // onLoaded is a callback prop; re-running on its identity would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memorialId, cemetery.placeId]);

  async function adopt(s: GraveSuggestion) {
    setBusyId(s.id);
    setError('');
    const { ok, data } = await authedPost<{ plotId?: string; code?: string }>('/api/grave-records/adopt', {
      graveRecordId: s.id,
      memorialId,
    });
    if (ok && data.plotId) {
      onAdopted(data.plotId);
      return;
    }
    if (data.code === 'already_adopted' && data.plotId) {
      // Someone got there first: switch this card to "ask to join".
      setSuggestions((cur) => (cur || []).map((x) => (x.id === s.id ? { ...x, adopted: true, plotId: data.plotId! } : x)));
    }
    setError(data.error || 'Something went wrong. Please try again.');
    setBusyId(null);
  }

  async function askToJoin(s: GraveSuggestion) {
    if (!s.plotId || !auth.currentUser) return;
    setBusyId(s.id);
    setError('');
    try {
      await attachMemorialToExistingPlot({
        memorialId,
        personId,
        plotId: s.plotId,
        requestedByUid: auth.currentUser.uid,
      });
      onJoinRequested();
    } catch (err: any) {
      setError(err?.message || 'Could not send the request.');
      setBusyId(null);
    }
  }

  async function sendReport(id: string) {
    const { ok, data } = await authedPost('/api/grave-records/report', { graveRecordId: id, reason: reportText });
    if (!ok) {
      setError(data.error || 'Could not send the report.');
      return;
    }
    setReported((r) => [...r, id]);
    setReportingId(null);
    setReportText('');
  }

  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <div className="eyebrow">From the {cemetery.name} burial register</div>
      <h3 style={{ marginTop: 8 }}>
        {suggestions.length === 1 ? 'Could this be the grave you’re looking for?' : 'Could one of these be the grave?'}
      </h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
        The parish has put its burial records online. If you recognise the grave, choose it and
        everything the register knows comes with it. If not, carry on below.
      </p>

      {suggestions.map((s) => {
        const matched = s.burials[s.matchedIndex] || s.burials[0];
        const others = s.burials.filter((_, i) => i !== s.matchedIndex);
        return (
          <div key={s.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{matched?.name}</div>
            <div className="muted" style={{ fontSize: 14 }}>
              {[
                matched?.nickname && `Known as ${matched.nickname}`,
                matched?.died && `Died ${matched.died}`,
                matched?.age && `aged ${matched.age}`,
                matched?.relations,
                matched?.address,
              ]
                .filter(Boolean)
                .join(', ')}
            </div>
            <div className="muted" style={{ fontSize: 14, marginTop: 6 }}>
              {s.label || 'No row or plot number recorded'}
              {s.hasPin && ' · 📍 pinned on the map'}
            </div>
            {others.length > 0 && (
              <p style={{ fontSize: 14, margin: '8px 0 0' }}>
                Also resting here: {others.map((o) => `${o.name}${o.died ? ` (${o.died})` : ''}`).join(', ')}
              </p>
            )}
            {s.inscription && (
              <blockquote className="muted" style={{ fontSize: 14, fontStyle: 'italic', margin: '10px 0 0' }}>
                &ldquo;{s.inscription}&rdquo;
              </blockquote>
            )}

            {s.adopted ? (
              <>
                <p className="muted" style={{ fontSize: 14, marginBottom: 0 }}>
                  Another family member already looks after this grave on LiveOnWith.me. You can
                  ask to add this memorial to it; they&rsquo;ll get a request to approve.
                </p>
                <div style={{ marginTop: 12 }}>
                  <button type="button" className="button" disabled={busyId !== null} onClick={() => askToJoin(s)}>
                    {busyId === s.id ? 'Sending…' : 'Ask to join this grave'}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ marginTop: 12 }}>
                <button type="button" className="button" disabled={busyId !== null} onClick={() => adopt(s)}>
                  {busyId === s.id ? 'Linking…' : 'Yes, this is the grave'}
                </button>
              </div>
            )}

            <div style={{ marginTop: 10, fontSize: 13 }}>
              {reported.includes(s.id) ? (
                <span className="muted">Thanks, we&rsquo;ll take a look.</span>
              ) : reportingId === s.id ? (
                <div>
                  <textarea
                    rows={2}
                    style={{ width: '100%' }}
                    placeholder="What looks wrong? e.g. the date, the spelling, the wrong row"
                    value={reportText}
                    onChange={(e) => setReportText(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button
                      type="button"
                      className="button secondary small"
                      disabled={reportText.trim().length < 3}
                      onClick={() => sendReport(s.id)}
                    >
                      Send
                    </button>
                    <button type="button" className="button secondary small" onClick={() => setReportingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setReportingId(s.id)}
                  style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}
                  className="muted"
                >
                  Something wrong in this record?
                </button>
              )}
            </div>
          </div>
        );
      })}
      {error && <p style={{ color: '#a94442', fontSize: 14 }}>{error}</p>}
    </div>
  );
}
