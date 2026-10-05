'use client';
import { newRequestId } from '../../lib/request-id';
import { useEffect, useState } from 'react';
import { staff, API, session } from '../../lib/api';
import { displayLabel } from '../../lib/labels';
export function LocalCareTools({
  patientId,
  data,
  documents,
  onSaved,
}: {
  patientId: string;
  data: any;
  documents: any[];
  onSaved: () => Promise<void>;
}) {
  const [templates, setTemplates] = useState<any[]>([]),
    [template, setTemplate] = useState(''),
    [start, setStart] = useState(''),
    [owner, setOwner] = useState(''),
    [request, setRequest] = useState(() => newRequestId());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [question, setQuestion] = useState(''),
    [records, setRecords] = useState<any>(null),
    [documentId, setDocument] = useState(''),
    [preview, setPreview] = useState(''),
    [pages, setPages] = useState<any[]>([]);
  const [title, setTitle] = useState(''),
    [due, setDue] = useState(''),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [decisions, setDecisions] = useState<Record<string, string>>({});
  useEffect(() => {
    staff('/staff/workbench/template-list', {})
      .then((r) => setTemplates(r.templates))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await onSaved();
      setMessage('Saved or loaded.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const search = (page = 0) =>
    run(async () =>
      setRecords(await staff('/staff/workbench/record-search', { patientId, question, page })),
    );
  const openSource = async () => {
    setPages([]);
    const r = await fetch(`${API}/staff/documents/${documentId}`, {
      headers: { Authorization: `Bearer ${session.get()?.token}` },
    });
    if (!r.ok) throw new Error('Could not open the original report');
    setPreview(URL.createObjectURL(await r.blob()));
  };
  const next: Record<string, string[]> = {
    preparing: ['submitted', 'cancelled'],
    submitted: ['more_information', 'approved', 'denied', 'cancelled'],
    more_information: ['submitted', 'cancelled'],
    approved: ['closed'],
    denied: ['closed'],
  };
  return (
    <section>
      <h3>Plan and review care</h3>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <details>
        <summary>Use a reusable clinic plan</summary>
        <a href="/doctor/templates">Manage reusable plans</a>
        <fieldset disabled={busy}>
          <label>
            Approved clinic plan
            <select
              aria-label="Approved clinic plan"
              value={template}
              onChange={(e) => {
                setTemplate(e.target.value);
                setRequest(newRequestId());
              }}
            >
              <option value="">Choose plan and version</option>
              {templates
                .filter((t) => t.approved_at && !t.archived_at)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} · version {t.version}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Plan starts (your device time)
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                setRequest(newRequestId());
              }}
            />
          </label>
          <label>
            Plan owner
            <select
              aria-label="Plan owner"
              value={owner}
              onChange={(e) => {
                setOwner(e.target.value);
                setRequest(newRequestId());
              }}
            >
              <option value="">Choose doctor</option>
              {data.staff.map((d: any) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <p>
            Relative days are 24-hour intervals from this time. Check all dates and wording for this
            patient before approving.
          </p>
          <button
            disabled={!template || !start || !owner}
            onClick={() =>
              run(async () => {
                await staff('/staff/workbench/template-apply', {
                  id: template,
                  patientId,
                  assignedTo: owner,
                  startAt: new Date(start).toISOString(),
                  requestId: request,
                });
                setTemplate('');
                setRequest(newRequestId());
              })
            }
          >
            Create patient plan for review
          </button>
        </fieldset>
      </details>
      <details>
        <summary>Find facts and browse the full record</summary>
        <p>
          Try “show medicines”, “why was medicine changed”, “allergies”, “test results outside
          range”, or a recorded name. Answers show original excerpts, not generated clinical advice.
          Leave blank for the dated record.
        </p>
        <label>
          Question or recorded words
          <input value={question} onChange={(e) => setQuestion(e.target.value)} />
        </label>
        <button disabled={busy} onClick={() => search()}>
          Find recorded facts
        </button>
        {records && (
          <>
            <p>
              {records.total} matching records. {records.message}
            </p>
            {records.records.map((r: any) => (
              <article className="card" key={r.source + r.id}>
                <b>
                  {displayLabel(r.kind)} · {new Date(r.at).toLocaleDateString()} ·{' '}
                  {r.verified ? 'Verified/signed source' : 'Check source'}
                </b>
                <pre style={{ whiteSpace: 'pre-wrap' }}>{r.body}</pre>
                {r.source === 'document' ? (
                  <button
                    onClick={() =>
                      run(async () => {
                        const response = await fetch(`${API}/staff/documents/${r.id}`, {
                          headers: { Authorization: `Bearer ${session.get()?.token}` },
                        });
                        if (!response.ok) throw new Error('Report unavailable');
                        const url = URL.createObjectURL(await response.blob());
                        window.open(url, '_blank');
                        setTimeout(() => URL.revokeObjectURL(url), 60000);
                      })
                    }
                  >
                    Open original document
                  </button>
                ) : (
                  <a
                    href={`#${r.source}-${r.id}`}
                    onClick={() =>
                      document
                        .getElementById(`${r.source}-${r.id}`)
                        ?.closest('details')
                        ?.setAttribute('open', '')
                    }
                  >
                    Open original record
                  </a>
                )}
              </article>
            ))}
            <button disabled={busy || records.page === 0} onClick={() => search(records.page - 1)}>
              Earlier page
            </button>
            <button
              disabled={busy || (records.page + 1) * 25 >= records.total}
              onClick={() => search(records.page + 1)}
            >
              Next record page
            </button>
          </>
        )}
      </details>
      <details>
        <summary>Read a report beside its extracted text</summary>
        <p>
          PDF text extraction runs locally. It does not interpret results or verify values.
          Scanned/image-only reports need manual entry; there is no invented confidence score.
        </p>
        <label>
          Source report
          <select
            aria-label="Source report"
            value={documentId}
            onChange={(e) => {
              setDocument(e.target.value);
              setPages([]);
              setPreview('');
            }}
          >
            <option value="">Choose uploaded report</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.filename}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy || !documentId} onClick={() => run(openSource)}>
          Show original beside text
        </button>{' '}
        <button
          disabled={busy || !documentId}
          onClick={() =>
            run(async () => {
              await openSource();
              const r = await staff('/staff/workbench/report-extract', { patientId, documentId });
              setPages(r.pages);
            })
          }
        >
          Extract PDF text locally
        </button>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))',
            gap: 12,
          }}
        >
          {preview && (
            <iframe
              title="Original source report"
              src={preview}
              style={{ width: '100%', height: 500, border: '1px solid #ccc' }}
            />
          )}
          <div>
            {pages.length > 0 && !pages.some((p) => p.text.trim()) && (
              <p>No selectable text found. Read the original and record results manually.</p>
            )}
            {pages.map((p) => (
              <section key={p.page}>
                <h4>Unverified text · page {p.page}</h4>
                <textarea
                  aria-label={`Extracted text page ${p.page}`}
                  value={p.text}
                  readOnly
                  rows={10}
                />
              </section>
            ))}
          </div>
        </div>
      </details>
      <details>
        <summary>Record review of test results</summary>
        <p>
          Values outside the report’s supplied range stay in the inbox until a doctor records
          review. Being within a supplied range does not establish clinical normality.
        </p>
        {data.entries
          .filter((e: any) => e.kind === 'lab' && e.verified_at && e.status === 'active')
          .map((e: any) => (
            <article className="card" key={e.id}>
              <b>
                {e.data.name}: {e.data.value} {e.data.unit}
              </b>
              <p>
                {e.occurred_on} · Report range {e.data.low ?? 'Not supplied'} –{' '}
                {e.data.high ?? 'Not supplied'}
              </p>
              {e.result_reviewed_at ? (
                <p>Review recorded: {e.result_review_note}</p>
              ) : (
                <>
                  <label>
                    Doctor’s result review
                    <textarea
                      value={decisions[e.id] ?? ''}
                      onChange={(v) => setDecisions({ ...decisions, [e.id]: v.target.value })}
                    />
                  </label>
                  <button
                    disabled={busy || !decisions[e.id]?.trim()}
                    onClick={() =>
                      run(() =>
                        staff('/staff/workbench/result-review', {
                          id: e.id,
                          note: decisions[e.id],
                        }),
                      )
                    }
                  >
                    Save doctor review
                  </button>
                </>
              )}
            </article>
          ))}
      </details>
      <details id="insurance-work">
        <summary>Insurance and pre-authorization paperwork</summary>
        <p>
          Track work already performed. Recording an insurer decision does not decide eligibility or
          send a submission.
        </p>
        <fieldset disabled={busy}>
          <label>
            Paperwork title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Paperwork owner
            <select
              aria-label="Paperwork owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="">Choose doctor</option>
              {data.staff.map((d: any) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Paperwork due (your device time)
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label>
            Supporting document
            <select
              aria-label="Supporting document"
              value={documentId}
              onChange={(e) => setDocument(e.target.value)}
            >
              <option value="">Optional uploaded record</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.filename}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!title || !owner || !due}
            onClick={() =>
              run(async () => {
                await staff('/staff/workbench/insurance-create', {
                  patientId,
                  title,
                  assignedTo: owner,
                  dueAt: new Date(due).toISOString(),
                  documentId: documentId || undefined,
                });
                setTitle('');
              })
            }
          >
            Add paperwork case
          </button>
        </fieldset>
        {data.insurance.map((c: any) => (
          <article className="card" key={c.id}>
            <h4>
              {c.title} · {displayLabel(c.status)}
            </h4>
            <p>
              {c.assignee} · due {new Date(c.due_at).toLocaleString()}
            </p>
            {next[c.status] && (
              <>
                <label>
                  Correspondence or action recorded
                  <textarea
                    value={notes[c.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
                  />
                </label>
                {next[c.status].map((state) => (
                  <button
                    key={state}
                    disabled={busy || !notes[c.id]?.trim()}
                    onClick={() => {
                      if (confirm(`Record ${displayLabel(state)} from actual correspondence?`))
                        void run(() =>
                          staff('/staff/workbench/insurance-update', {
                            id: c.id,
                            status: state,
                            note: notes[c.id],
                          }),
                        );
                    }}
                  >
                    Record {displayLabel(state)}
                  </button>
                ))}
              </>
            )}
            {data.insuranceHistory
              .filter((h: any) => h.case_id === c.id)
              .map((h: any) => (
                <p key={h.id}>
                  {new Date(h.created_at).toLocaleString()} · {displayLabel(h.status)}: {h.note}
                </p>
              ))}
          </article>
        ))}
      </details>
    </section>
  );
}
