'use client';
import { useState } from 'react';
import { staff, useSession } from '../../../lib/api';

type Row = { name: string; phone: string; yearOfBirth?: string; age?: string; language?: string };

/** Minimal CSV reader: quoted fields, commas, tabs and semicolons, a header row if the first row has "name". */
function parseCsv(text: string): Row[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = [',', '\t', ';'].sort(
    (a, b) => lines[0].split(b).length - lines[0].split(a).length,
  )[0];
  const split = (l: string) => {
    const out: string[] = [];
    let cur = '',
      q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) {
        if (ch === '"' && l[i + 1] === '"') ((cur += '"'), i++);
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) (out.push(cur.trim()), (cur = ''));
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const first = split(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = first.some((c) => /name|phone|mobile/.test(c));
  const find = (re: RegExp, fallback: number) => {
    const i = first.findIndex((c) => re.test(c));
    return hasHeader ? i : fallback;
  };
  const iName = find(/name/, 0),
    iPhone = find(/phone|mobile|contact/, 1),
    iYear = find(/year|yob|birth/, -1),
    iAge = find(/^age/, -1),
    iLang = find(/lang/, -1);
  return lines.slice(hasHeader ? 1 : 0).map((l) => {
    const c = split(l);
    return {
      name: c[iName] ?? '',
      phone: c[iPhone] ?? '',
      yearOfBirth: iYear >= 0 ? c[iYear] : undefined,
      age: iAge >= 0 ? c[iAge] : undefined,
      language: iLang >= 0 ? c[iLang] : undefined,
    };
  });
}

export default function ImportPatients() {
  const s = useSession('receptionist');
  const [rows, setRows] = useState<Row[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  if (!s) return null;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const onFile = (f: File | undefined) =>
    f &&
    run(async () => {
      setDone(null);
      const r = parseCsv(await f.text());
      if (!r.length) throw new Error('The file has no rows');
      if (r.length > 2000) throw new Error('Up to 2000 patients at a time. Split the file.');
      setRows(r);
      setPreview(await staff('/staff/patient-import/preview', { rows: r }));
    });
  return (
    <div>
      <header className="doctor-page-heading">
        <div>
          <h1>Bring your patient list</h1>
          <p className="muted">
            Upload a CSV with name and phone (optional: year of birth or age, language). Imported
            patients are <b>not messaged</b>. They give consent when they first check in.
          </p>
        </div>
      </header>
      <section className="card">
        <label htmlFor="csv">Patient list (.csv)</label>
        <input
          id="csv"
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {err && (
          <div className="error" role="alert">
            {err}
          </div>
        )}
        {preview && !done && (
          <div data-testid="import-preview" style={{ marginTop: '1rem' }}>
            <p>
              <b>{preview.counts.new}</b> new · {preview.counts.duplicateExisting} already in your
              clinic · {preview.counts.duplicateInFile} repeated in the file ·{' '}
              {preview.counts.invalid} need fixing
            </p>
            {preview.problems.length > 0 && (
              <ul className="muted">
                {preview.problems.map((p: any) => (
                  <li key={p.line}>
                    Row {p.line}:{' '}
                    {p.status === 'invalid'
                      ? p.reason
                      : p.status === 'duplicate_existing'
                        ? 'already a patient (skipped)'
                        : 'repeated in this file (skipped)'}
                  </li>
                ))}
              </ul>
            )}
            <button
              disabled={busy || !preview.counts.new}
              onClick={() =>
                run(async () => setDone(await staff('/staff/patient-import/commit', { rows })))
              }
            >
              Import {preview.counts.new} patients
            </button>
          </div>
        )}
        {done && (
          <div data-testid="import-done" style={{ marginTop: '1rem' }}>
            <p>Imported {done.imported} patients. Nobody was messaged.</p>
            <button
              className="ghost"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const u = await staff(`/staff/patient-import/${done.batchId}/undo`, {});
                  setDone(null);
                  setPreview(null);
                  setErr(
                    `Undone: ${u.removed} removed${u.kept ? `, ${u.kept} kept because they already have records` : ''}.`,
                  );
                })
              }
            >
              Undo this import
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
