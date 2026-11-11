'use client';
// "Tell us about your register": a few questions about how the parish's
// records are kept and what's in them. From the answers we build a
// spreadsheet template with just those columns and an AI prompt the
// registrar can paste into ChatGPT, Claude or similar alongside photos of
// the register pages.

import { useEffect, useMemo, useState } from 'react';
import {
  REGISTER_FIELDS,
  buildAiPrompt,
  templateCsv,
  type RegisterField,
  type RegisterFormat,
} from '@/lib/register-parse';

const FORMATS: { value: RegisterFormat; label: string }[] = [
  { value: 'handwritten', label: 'Handwritten book or ledger' },
  { value: 'cards', label: 'Handwritten cards or loose sheets' },
  { value: 'typed', label: 'Typed or printed pages' },
  { value: 'spreadsheet', label: 'Already on a computer (Excel, Word, etc.)' },
  { value: 'other', label: 'Something else / not sure' },
];

const DEFAULT_FIELDS: RegisterField[] = ['section', 'row', 'plotNumber', 'age', 'address'];

type Props = {
  placeId: string;
  cemeteryName: string;
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
};

export default function RegisterSetup({ placeId, cemeteryName, api }: Props) {
  const [format, setFormat] = useState<RegisterFormat>('handwritten');
  const [fields, setFields] = useState<RegisterField[]>(DEFAULT_FIELDS);
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ profile: { format: RegisterFormat; fields: RegisterField[]; notes: string } | null }>(
      `/api/registrar/profile?placeId=${encodeURIComponent(placeId)}`,
    )
      .then(({ profile }) => {
        if (!profile) return;
        setFormat(profile.format);
        setFields(profile.fields);
        setNotes(profile.notes);
        setSaved(true);
      })
      .catch(() => {});
  }, [placeId, api]);

  const askable = REGISTER_FIELDS.filter((f) => f.askable && !f.required);
  const prompt = useMemo(() => buildAiPrompt({ selected: fields, format, cemeteryName }), [fields, format, cemeteryName]);

  function toggle(f: RegisterField) {
    setSaved(false);
    setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  }

  async function save() {
    setError('');
    try {
      await api('/api/registrar/profile', { method: 'POST', body: JSON.stringify({ placeId, format, fields, notes }) });
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([templateCsv(fields)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cemeteryName.replace(/[^\w\s-]/g, '').trim() || 'burial'} register.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Couldn’t copy. Select the text and copy it instead.');
    }
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>1. Tell us about your register</h3>
      <p className="muted" style={{ marginTop: 0 }}>How are the burial records kept now?</p>
      <div style={{ display: 'grid', gap: 6 }}>
        {FORMATS.map((f) => (
          <label key={f.value} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="radio"
              name="register-format"
              checked={format === f.value}
              onChange={() => {
                setFormat(f.value);
                setSaved(false);
              }}
            />
            {f.label}
          </label>
        ))}
      </div>

      <p className="muted" style={{ margin: '16px 0 6px' }}>
        Besides names and dates of death, what does it record? Tick whatever you see in it.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
        {askable.map((f) => (
          <label key={f.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={fields.includes(f.key)} onChange={() => toggle(f.key)} style={{ marginTop: 4 }} />
            {f.question}
          </label>
        ))}
      </div>
      <label style={{ display: 'block', marginTop: 12 }}>
        <span className="fieldLabel">Anything else we should know? (optional)</span>
        <textarea
          rows={2}
          style={{ width: '100%' }}
          placeholder="e.g. two books, 1890–1950 and 1950 to today; the old book is in Irish"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      <button type="button" className="button secondary small" onClick={save} disabled={saved}>
        {saved ? 'Saved' : 'Save answers'}
      </button>

      <h3 style={{ marginTop: 28 }}>2. Turn it into a spreadsheet</h3>
      {format === 'spreadsheet' ? (
        <p className="muted" style={{ marginTop: 0 }}>
          If it&rsquo;s already in Excel, make sure the first row has column headings like the template
          below, then save it as CSV (File → Save As → CSV) and upload it in step 3.
        </p>
      ) : (
        <ol className="muted" style={{ marginTop: 0, paddingLeft: 20 }}>
          <li>Photograph each page flat, in good light, one page per photo.</li>
          <li>Open ChatGPT, Claude or a similar AI assistant and start a new chat.</li>
          <li>Copy the instructions below, paste them in, and attach the photos (a few pages at a time works best).</li>
          <li>It will give you the register as a table. Check any words marked ?? against the book.</li>
          <li>Copy the table and paste it into step 3, or save it as a spreadsheet and upload that.</li>
        </ol>
      )}
      <textarea readOnly rows={8} value={prompt} style={{ width: '100%', fontSize: 13 }} onFocus={(e) => e.currentTarget.select()} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
        <button type="button" className="button small" onClick={copyPrompt}>
          {copied ? 'Copied' : 'Copy the AI instructions'}
        </button>
        <button type="button" className="button secondary small" onClick={downloadTemplate}>
          Download a blank template
        </button>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Photos you give an AI assistant are handled under that company&rsquo;s terms. If the register
        holds anything sensitive, check with your parish first.
      </p>
      {error && <p style={{ color: '#a94442', fontSize: 14 }}>{error}</p>}
    </div>
  );
}
