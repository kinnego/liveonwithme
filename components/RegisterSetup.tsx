'use client';
// "Tell us about your register": a few questions about how the parish's
// records are kept and what's in them. From the answers we build a
// spreadsheet template with just those columns and an AI prompt the
// registrar can paste into ChatGPT, Claude or similar alongside photos of
// the register pages.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  /** Step 3, the paste box, shown as the last of the three steps. */
  upload: ReactNode;
  /** Open this step first, e.g. 2 to go straight to the ChatGPT instructions. */
  initialStep?: 1 | 2 | 3;
};

/**
 * One of the three steps, folded away until it's needed. The whole heading
 * is the button, so it's an easy target on a phone.
 */
function Step({
  n,
  title,
  done,
  open,
  onToggle,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section style={{ border: '2px solid var(--line)', borderRadius: 16, background: 'white', marginTop: 10 }}>
      <h3 style={{ margin: 0 }}>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            textAlign: 'left',
            background: 'none',
            border: 0,
            padding: '14px 16px',
            font: 'inherit',
            fontSize: 20,
            fontWeight: 700,
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              flex: 'none',
              width: 32,
              height: 32,
              borderRadius: 999,
              display: 'grid',
              placeItems: 'center',
              fontSize: 16,
              background: done ? 'var(--sage, #dde5df)' : 'var(--line)',
            }}
          >
            {done ? '✓' : n}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="muted" style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
              Step {n} of 3{done ? ' · done' : ''}
            </span>
            {title}
          </span>
          <span aria-hidden="true" style={{ flex: 'none', fontSize: 18, transform: open ? 'rotate(180deg)' : 'none' }}>
            ⌄
          </span>
        </button>
      </h3>
      {open && <div style={{ padding: '0 16px 18px' }}>{children}</div>}
    </section>
  );
}

export default function RegisterSetup({ placeId, cemeteryName, api, upload, initialStep }: Props) {
  const [format, setFormat] = useState<RegisterFormat>('handwritten');
  const [fields, setFields] = useState<RegisterField[]>(DEFAULT_FIELDS);
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [copiedOnce, setCopiedOnce] = useState(false);
  // Which steps are unfolded. Someone who has set up before goes straight
  // to pasting; someone new starts at step 1.
  const [open, setOpen] = useState<Set<number>>(new Set([initialStep || 1]));
  const toggleStep = (n: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

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
        if (!initialStep) setOpen(new Set([3]));
      })
      .catch(() => {});
  }, [placeId, api, initialStep]);

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
      setOpen(new Set([2]));
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
      setCopiedOnce(true);
      setOpen((cur) => new Set([...cur, 3]));
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
      <Step n={1} title="What does your burial book look like?" done={saved} open={open.has(1)} onToggle={() => toggleStep(1)}>
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
      </Step>

      <Step
        n={2}
        title={format === 'spreadsheet' ? 'Get your spreadsheet ready' : 'Let ChatGPT type out the names'}
        done={copiedOnce}
        open={open.has(2)}
        onToggle={() => toggleStep(2)}
      >
      {format === 'spreadsheet' ? (
        <>
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
          <p style={{ marginTop: 0 }}>
            Our app can&rsquo;t read handwriting by itself. So you use <strong>ChatGPT</strong>, a free
            app that can read photos, to type the book out as a tidy list. Our instructions tell it
            exactly how to lay the list out, so it fits straight into LiveOnWith.me.
          </p>
          <PhotoToAppFlow />
          <ol style={{ marginTop: 0, paddingLeft: 22, display: 'grid', gap: 8 }}>
            <li>
              Take a photo of each page with your phone. Lay the book flat, in good light. Photos work far
              better than videos.
            </li>
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
          <p className="muted" style={{ fontSize: 14 }}>
            Send ChatGPT a few photos at a time. It tells you how many names it found on each photo, so
            you can check nothing was missed.
          </p>
        </>
      )}
      </Step>

      <Step n={3} title="Paste the names in" open={open.has(3)} onToggle={() => toggleStep(3)}>
        {upload}
      </Step>
      {error && <p style={{ color: '#a94442', fontSize: 15 }}>{error}</p>}
    </div>
  );
}
