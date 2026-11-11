'use client';
// "Tell us about your register": a few questions about how the parish's
// records are kept and what's in them. From the answers we build a
// spreadsheet template with just those columns and an AI prompt the
// registrar can paste into ChatGPT, Claude or similar alongside photos of
// the register pages.

import { useEffect, useMemo, useState } from 'react';
import { PhotoToAppFlow } from '@/components/ParishIcons';
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

  const big = { fontSize: 17 } as const;
  const choice = (checked: boolean): React.CSSProperties => ({
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    border: `2px solid ${checked ? 'var(--ink)' : 'var(--line)'}`,
    borderRadius: 14,
    padding: '12px 14px',
    background: 'white',
    cursor: 'pointer',
    margin: 0,
    fontWeight: checked ? 700 : 500,
    fontSize: 17,
  });

  return (
    <div style={big}>
      <h3 style={{ marginTop: 0, fontSize: 24 }}>Step 1 of 3: What does your burial book look like?</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {FORMATS.map((f) => (
          <label key={f.value} style={choice(format === f.value)}>
            <input
              type="radio"
              name="register-format"
              checked={format === f.value}
              onChange={() => {
                setFormat(f.value);
                setSaved(false);
              }}
              style={{ width: 20, height: 20, flex: 'none' }}
            />
            {f.label}
          </label>
        ))}
      </div>

      <p style={{ margin: '20px 0 8px' }}>
        <strong>What else is written in it?</strong> Tick any you see. Names and dates are already
        included.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
        {askable.map((f) => (
          <label key={f.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: 0, fontWeight: 500, fontSize: 17 }}>
            <input
              type="checkbox"
              checked={fields.includes(f.key)}
              onChange={() => toggle(f.key)}
              style={{ width: 20, height: 20, flex: 'none', marginTop: 3 }}
            />
            {f.question}
          </label>
        ))}
      </div>
      <label style={{ display: 'block', marginTop: 14 }}>
        <span className="fieldLabel">Anything else we should know? (you can leave this empty)</span>
        <textarea
          rows={2}
          style={{ width: '100%' }}
          placeholder="e.g. there are two books; the old one is in Irish"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      <button type="button" className="button secondary" onClick={save} disabled={saved}>
        {saved ? '✓ Saved' : 'Save my answers'}
      </button>

      {format === 'spreadsheet' ? (
        <>
          <h3 style={{ marginTop: 32, fontSize: 24 }}>Step 2 of 3: Get your spreadsheet ready</h3>
          <ol style={{ marginTop: 0, paddingLeft: 22, display: 'grid', gap: 6 }}>
            <li>Open it in Excel or Google Sheets.</li>
            <li>
              Make sure the top row has headings, such as <em>Surname</em>, <em>First names</em> and{' '}
              <em>Died</em>.
            </li>
            <li>Select all the rows, copy them, and paste them into step 3 below.</li>
          </ol>
          <button type="button" className="button secondary small" onClick={downloadTemplate}>
            Download an example spreadsheet
          </button>
        </>
      ) : (
        <>
          <h3 style={{ marginTop: 32, fontSize: 24 }}>Step 2 of 3: Let ChatGPT type out the names</h3>
          <p style={{ marginTop: 0 }}>
            Our app can&rsquo;t read handwriting by itself. So you use <strong>ChatGPT</strong>, a free
            app that can read photos, to type the book out as a tidy list. Our instructions tell it
            exactly how to lay the list out, so it fits straight into LiveOnWith.me.
          </p>
          <PhotoToAppFlow />
          <ol style={{ marginTop: 0, paddingLeft: 22, display: 'grid', gap: 8 }}>
            <li>Take a photo of each page with your phone. Lay the book flat, in good light.</li>
            <li>Open ChatGPT on your phone or computer and start a new chat.</li>
            <li>
              Tap the button below to copy our instructions. Then paste them into ChatGPT.
            </li>
            <li>Add your photos, a few pages at a time, and send them.</li>
            <li>
              ChatGPT gives you back a table of names. Copy it, and paste it into step 3 below.
            </li>
          </ol>
          <button type="button" className="button" onClick={copyPrompt} style={{ fontSize: 17 }}>
            {copied ? '✓ Copied. Now paste it into ChatGPT' : 'Copy the instructions for ChatGPT'}
          </button>
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer' }}>See the instructions</summary>
            <textarea
              readOnly
              rows={8}
              value={prompt}
              style={{ width: '100%', fontSize: 13, marginTop: 8 }}
              onFocus={(e) => e.currentTarget.select()}
            />
          </details>
          <p className="muted" style={{ fontSize: 14 }}>
            Words ChatGPT couldn&rsquo;t read are marked <strong>??</strong>. You can fix those later.
            If your book holds anything private, leave those pages out.
          </p>
        </>
      )}
      {error && <p style={{ color: '#a94442', fontSize: 15 }}>{error}</p>}
    </div>
  );
}
