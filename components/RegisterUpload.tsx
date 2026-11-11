'use client';
// Upload or paste a burial register spreadsheet, preview what it will do,
// choose whether matching graves are updated or left alone, then save.

import { useState } from 'react';
import type { Cemetery } from '@/lib/types';

type Summary = {
  people: number;
  graves: number;
  added: number;
  updated: number;
  handEditedOverwritten: number;
  skippedAdopted: number;
  skippedExisting: number;
  skippedRows: number[];
  uncertainCells: number;
  unknownHeaders: string[];
  matchedExisting: number;
  sample: { label: string; names: string[] }[];
};

type Mode = 'add_and_update' | 'add_only';

type Props = {
  cemetery: Cemetery;
  hasExisting: boolean;
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
  onDone: () => void;
};

export default function RegisterUpload({ cemetery, hasExisting, api, onDone }: Props) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<Mode>('add_and_update');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Summary | null>(null);

  function reset() {
    setSummary(null);
    setError('');
    setDone(null);
  }

  async function onFile(f: File | undefined) {
    reset();
    if (!f) return;
    if (/\.(xlsx|xls|numbers|ods)$/i.test(f.name)) {
      setError('Please save the spreadsheet as CSV first (File → Save As → CSV), or open it, select all, copy, and paste it in the box below.');
      return;
    }
    setFileName(f.name);
    setText(await f.text());
  }

  async function run(preview: boolean) {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ summary: Summary }>('/api/grave-records/upload', {
        method: 'POST',
        body: JSON.stringify({ cemetery, fileName: fileName || 'Pasted table', text, mode, preview }),
      });
      if (preview) setSummary(res.summary);
      else {
        setDone(res.summary);
        setSummary(null);
        setText('');
        setFileName('');
        onDone();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div>
        <h3 style={{ marginTop: 0 }}>Uploaded</h3>
        <p>
          {done.added} new {done.added === 1 ? 'grave' : 'graves'} added
          {done.updated ? `, ${done.updated} updated` : ''}
          {done.skippedAdopted + done.skippedExisting ? `, ${done.skippedAdopted + done.skippedExisting} left as they were` : ''}.
        </p>
        <p className="muted">
          Next: walk the graveyard and pin each grave. Turn on &ldquo;Walk the graveyard&rdquo; below, search
          for the name on a headstone, and tap &ldquo;Pin here&rdquo;.
        </p>
        <button type="button" className="button secondary small" onClick={reset}>
          Upload another sheet
        </button>
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>3. Upload it</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Choose a CSV file, or paste the table straight from Excel, Google Sheets or the AI chat. The
        first row must be the column headings.
      </p>
      <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={(e) => onFile(e.target.files?.[0])} />
      <textarea
        rows={6}
        style={{ width: '100%', marginTop: 10, fontSize: 13 }}
        placeholder={'…or paste here, e.g.\nSection,Row,Plot,Surname,Forenames,Died\nA,1,1,Gallagher,Patrick,1952'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!fileName || fileName === 'Pasted table') setFileName('Pasted table');
          setSummary(null);
        }}
      />

      {hasExisting && (
        <fieldset style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, marginTop: 10 }}>
          <legend className="fieldLabel" style={{ padding: '0 6px' }}>
            If a grave is already in the register
          </legend>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input type="radio" name="upload-mode" checked={mode === 'add_and_update'} onChange={() => { setMode('add_and_update'); setSummary(null); }} style={{ marginTop: 4 }} />
            <span>
              <strong>Update it from this sheet.</strong> <span className="muted">Best when this sheet is a corrected version. Pins and inscriptions already added are kept.</span>
            </span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6 }}>
            <input type="radio" name="upload-mode" checked={mode === 'add_only'} onChange={() => { setMode('add_only'); setSummary(null); }} style={{ marginTop: 4 }} />
            <span>
              <strong>Leave it as it is.</strong> <span className="muted">Only add graves that aren&rsquo;t there yet. Best when adding another book or page range.</span>
            </span>
          </label>
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
            A grave counts as the same when its section, row and plot number match, or, with no plot
            number, the person&rsquo;s name and year of death. Graves a family looks after are never changed.
          </p>
        </fieldset>
      )}

      {!summary && (
        <button type="button" className="button" style={{ marginTop: 12 }} disabled={busy || !text.trim()} onClick={() => run(true)}>
          {busy ? 'Checking…' : 'Check it before saving'}
        </button>
      )}

      {summary && (
        <div className="card" style={{ marginTop: 12, background: 'var(--soft, transparent)' }}>
          <p style={{ marginTop: 0 }}>
            <strong>
              {summary.people} {summary.people === 1 ? 'person' : 'people'} in {summary.graves}{' '}
              {summary.graves === 1 ? 'grave' : 'graves'}.
            </strong>{' '}
            {summary.added} new{summary.updated ? `, ${summary.updated} will be updated` : ''}
            {summary.skippedExisting ? `, ${summary.skippedExisting} already there (left alone)` : ''}
            {summary.skippedAdopted ? `, ${summary.skippedAdopted} looked after by families (left alone)` : ''}.
          </p>
          {summary.handEditedOverwritten > 0 && (
            <p style={{ color: '#8a5a00' }}>
              {summary.handEditedOverwritten} of the graves being updated were fixed by hand since they were
              added. Updating will replace those fixes with what&rsquo;s in this sheet. Choose &ldquo;Leave it as
              it is&rdquo; to keep them.
            </p>
          )}
          {summary.uncertainCells > 0 && (
            <p>
              {summary.uncertainCells} {summary.uncertainCells === 1 ? 'entry is' : 'entries are'} marked ?? as hard
              to read. You can upload now and fix them later, or check them in the sheet first.
            </p>
          )}
          {summary.skippedRows.length > 0 && (
            <p className="muted">
              Rows with no surname will be skipped: row {summary.skippedRows.slice(0, 10).join(', ')}
              {summary.skippedRows.length > 10 ? ` and ${summary.skippedRows.length - 10} more` : ''}.
            </p>
          )}
          {summary.unknownHeaders.length > 0 && (
            <p className="muted">
              These columns weren&rsquo;t recognised and will be ignored: {summary.unknownHeaders.join(', ')}.
            </p>
          )}
          <div className="muted" style={{ fontSize: 14 }}>
            First few graves:
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {summary.sample.map((g, i) => (
                <li key={i}>
                  {g.label ? `${g.label}: ` : ''}
                  {g.names.join('; ')}
                </li>
              ))}
            </ul>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" className="button" disabled={busy || summary.added + summary.updated === 0} onClick={() => run(false)}>
              {busy ? 'Saving…' : 'Looks right, save it'}
            </button>
            <button type="button" className="button secondary" disabled={busy} onClick={() => setSummary(null)}>
              Go back
            </button>
          </div>
        </div>
      )}
      {error && <p style={{ color: '#a94442', fontSize: 14 }}>{error}</p>}
    </div>
  );
}
