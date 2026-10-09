'use client';
import { newRequestId } from '../../lib/request-id';
import { LocalCareTools } from './LocalCareTools';
import { useCallback, useEffect, useState } from 'react';
import { staff } from '../../lib/api';
import { displayLabel } from '../../lib/labels';
import { useStaffLang } from '../../lib/staffText';
const fields: Record<string, string[]> = {
  medication: ['name', 'ingredient', 'dose', 'frequency', 'reason'],
  allergy: ['substance', 'reaction'],
  diagnosis: ['name', 'details'],
  lab: ['name', 'value', 'unit', 'low', 'high', 'sample', 'sourceText'],
  investigation: ['name', 'details'],
  referral: ['name', 'details'],
  insurance: ['name', 'details'],
};
const names: Record<string, string> = {
  name: 'Name',
  ingredient: 'Active ingredient (use the same name as allergy records)',
  dose: 'Dose stated by doctor',
  frequency: 'How often',
  reason: 'Reason / why it changed',
  substance: 'Allergy substance',
  reaction: 'Recorded reaction',
  details: 'Doctor’s recorded details',
  value: 'Result value',
  unit: 'Unit as printed',
  low: 'Lower reference limit (optional)',
  high: 'Upper reference limit (optional)',
  sample: 'Sample / method (optional)',
  sourceText: 'Exact text from the report',
};
const labels: Record<string, string> = {
  medication: 'Medicine',
  allergy: 'Allergy',
  diagnosis: 'Diagnosis recorded by doctor',
  lab: 'Test result',
  investigation: 'Requested test',
  referral: 'Referral',
  insurance: 'Insurance paperwork',
};
const today = () => new Date().toLocaleDateString('en-CA');
export function ClinicalWorkspace({
  patientId,
  notes,
  documents,
  onDocument,
  onSaved,
  activeArea = 'care',
}: {
  activeArea?: string;
  patientId: string;
  notes: any[];
  documents: any[];
  onDocument: (id: string) => void;
  onSaved?: () => void;
}) {
  const { x, lang: uiLang } = useStaffLang();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('medication'),
    [values, setValues] = useState<Record<string, string>>({}),
    [occurred, setOccurred] = useState(today()),
    [documentId, setDocument] = useState(''),
    [verified, setVerified] = useState(false);
  const [reportText, setReportText] = useState(''),
    [chargeText, setChargeText] = useState('Consultation'),
    [chargeAmount, setChargeAmount] = useState(''),
    [payments, setPayments] = useState<
      Record<string, { amount: string; method: string; requestId: string }>
    >({});
  const [search, setSearch] = useState(''),
    [noteId, setNote] = useState(''),
    [language, setLanguage] = useState('en'),
    [bodies, setBodies] = useState<Record<string, string>>({});
  const [stepEdits, setStepEdits] = useState<Record<string, any>>({});
  const [planTitle, setPlanTitle] = useState(''),
    [owner, setOwner] = useState(''),
    [steps, setSteps] = useState([{ title: '', message: '', dueAt: '' }]),
    [replies, setReplies] = useState<Record<string, string>>({});
  const load = useCallback(
    async () => setData(await staff(`/staff/patients/${patientId}/workspace`)),
    [patientId],
  );
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await load();
      setMessage('Saved.');
      onSaved?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const entryStatus = (id: string, status?: string, verify = false) =>
    run(() => staff('/staff/workbench/entry-status', { id, status, verify }));
  const saveEntry = () =>
    run(async () => {
      const entry: any = { kind };
      for (const field of fields[kind]) {
        const v = values[field]?.trim();
        if (['value', 'low', 'high'].includes(field)) {
          if (v) entry[field] = Number(v);
        } else if (v) entry[field] = v;
      }
      await staff('/staff/workbench/entries', {
        patientId,
        occurredOn: occurred,
        documentId: documentId || undefined,
        data: entry,
        verified,
      });
      setValues({});
      setVerified(false);
    });
  const planStatus = (id: string, status: string) =>
    run(() => staff('/staff/workbench/plan-status', { id, status }));
  const stepStatus = (id: string, status: string) =>
    run(() =>
      staff('/staff/workbench/steps', { id, status, response: replies[id]?.trim() || undefined }),
    );
  const download = (i: any) => {
    const url = URL.createObjectURL(new Blob([i.body], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `patient-instructions-${i.language}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  if (!data)
    return (
      <section
        id="care-workspace"
        hidden={!['all', 'care', 'records', 'admin'].includes(activeArea)}
        className="card clinical-workspace"
      >
        <h2>
          {x(activeArea === 'records'
            ? 'Timeline and source search'
            : activeArea === 'admin'
              ? 'Charges and paperwork'
              : 'Ongoing care')}
        </h2>
        {error ? <p role="alert">{error}</p> : <p>{x("Loading patient history…")}</p>}
      </section>
    );
  const entries = data.entries.filter((e: any) => e.status !== 'entered_in_error');
  const labs = entries.filter(
    (e: any) => e.kind === 'lab' && e.verified_at && e.status === 'active',
  );
  const selected = data.entries.filter((e: any) =>
    JSON.stringify(e.data).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section
      id="care-workspace"
      hidden={!['all', 'care', 'records', 'admin'].includes(activeArea)}
      className="card clinical-workspace"
      style={{ marginTop: 20 }}
    >
      <h2>
        {x(activeArea === 'records'
          ? 'Timeline and source search'
          : activeArea === 'admin'
            ? 'Charges and paperwork'
            : 'Ongoing care')}
      </h2>
      <p>{x("Doctor-recorded facts, approved instructions and follow-up work. Original reports and notes remain the source.")}</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <button onClick={() => void run(load)} disabled={busy}>{x("Refresh care record")}</button>
      <LocalCareTools
        activeArea={activeArea}
        patientId={patientId}
        data={data}
        documents={documents}
        onSaved={async () => {
          await load();
          onSaved?.();
        }}
      />
      <h3>{x("At a glance")}</h3>
      <p>
        {
          entries.filter(
            (e: any) => e.kind === 'medication' && e.status === 'active' && e.verified_at,
          ).length
        }{' '}
        {x('verified active medicines')} ·{' '}
        {
          entries.filter((e: any) => e.kind === 'allergy' && e.status === 'active' && e.verified_at)
            .length
        }{' '}
        {x('recorded allergies')} · {labs.length} {x('verified test results')}
      </p>
      <p>{x("No recorded allergies does not confirm that the patient has no allergies.")}</p>
      <details
        open={activeArea === 'all'}
        hidden={activeArea !== 'all' && activeArea !== 'records'}
      >
        <summary>{x("Add patient information")}</summary>
        <fieldset disabled={busy}>
          <label>
            {x('Type of information')}
            <select
              aria-label={x('Type of information')}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setValues({});
                setVerified(false);
              }}
            >
              {Object.entries(labels).map(([k, l]) => (
                <option key={k} value={k}>
                  {x(l)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {x('Date of event')}
            <input type="date" value={occurred} onChange={(e) => setOccurred(e.target.value)} />
          </label>
          {fields[kind].map((f) => (
            <label key={f}>
              {x(names[f])}
              <input
                aria-label={x(names[f])}
                type={['value', 'low', 'high'].includes(f) ? 'number' : 'text'}
                step="any"
                value={values[f] ?? ''}
                onChange={(e) => setValues({ ...values, [f]: e.target.value })}
              />
            </label>
          ))}
          <label>
            {x('Original report')} {x(kind === 'lab' ? '(required)' : '(optional)')}
            <select value={documentId} onChange={(e) => setDocument(e.target.value)}>
              <option value="">{x("Choose uploaded report")}</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.filename}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
            />
            {x('I checked this information against the source.')}
          </label>
          <button onClick={saveEntry}>{x("Save patient information")}</button>
        </fieldset>
      </details>
      <details
        open={activeArea === 'all'}
        hidden={activeArea !== 'all' && activeArea !== 'records'}
      >
        <summary>{x("Patient history and recorded changes")}</summary>
        <label>
          {x('Find in recorded history')}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={x('Medicine, test or diagnosis')}
          />
        </label>
        {selected.length === 0 && (
          <p>{x("No matching structured records. Check earlier notes and uploaded reports below.")}</p>
        )}
        {selected.map((e: any) => (
          <article
            key={e.id}
            id={`entry-${e.id}`}
            style={{ borderTop: '1px solid var(--line)', padding: 12 }}
          >
            <b>
              {x(labels[e.kind])} · {String(e.occurred_on).slice(0, 10)}
            </b>{' '}
            · {x(displayLabel(e.status))} · {x(e.verified_at ? 'Doctor verified' : 'Needs verification')}
            <dl>
              {Object.entries(e.data)
                .filter(([k]) => k !== 'kind')
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{x(names[k] ?? displayLabel(k))}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
            </dl>
            <p>
              {x('Recorded by')} {e.recorder}.{' '}
              {e.document_id && (
                <button onClick={() => onDocument(e.document_id)}>{x("Open original report")}</button>
              )}
            </p>
            <div className="row">
              {!e.verified_at && e.status === 'active' && (
                <button disabled={busy} onClick={() => entryStatus(e.id, undefined, true)}>{x("Confirm source checked")}</button>
              )}
              {e.status === 'active' && e.kind !== 'lab' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    entryStatus(
                      e.id,
                      ['medication', 'allergy', 'diagnosis'].includes(e.kind)
                        ? 'stopped'
                        : 'completed',
                    )
                  }
                >
                  {x(e.kind === 'medication' ? 'Record medicine stopped' : 'Mark completed')}
                </button>
              )}
              {e.status !== 'entered_in_error' && (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        x('Mark this entry as entered in error? Its history will remain visible.'),
                      )
                    )
                      void entryStatus(e.id, 'entered_in_error');
                  }}
                >{x("Mark entry incorrect")}</button>
              )}
            </div>
          </article>
        ))}
        <h4>{x("Earlier visits and original records")}</h4>
        {data.history.map((h: any) => (
          <p key={h.kind + h.id}>
            {new Date(h.at).toLocaleDateString(uiLang === 'hi' ? 'hi-IN' : 'en-IN')} ·{' '}
            {h.kind === 'document' ? (
              <button onClick={() => onDocument(h.id)}>{h.title}</button>
            ) : (
              <a href={h.kind === 'note' ? `#note-${h.id}` : `#visit-${h.id}`}>{h.title}</a>
            )}
          </p>
        ))}
      </details>
      <details
        open={activeArea === 'all'}
        hidden={activeArea !== 'all' && activeArea !== 'records'}
      >
        <summary>{x("Copy results from a report table")}</summary>
        <p>{x("Paste rows separated by tabs: test name, numeric result, unit, optional lower limit, upper limit, sample/method. These are saved as unverified and must be checked against the uploaded report. Scanned images and free-form report interpretation are not supported.")}</p>
        <fieldset disabled={busy}>
          <label>
            {x('Uploaded source report')}
            <select value={documentId} onChange={(e) => setDocument(e.target.value)}>
              <option value="">{x("Choose report")}</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.filename}
                </option>
              ))}
            </select>
          </label>
          <label>
            {x('Report date')}
            <input type="date" value={occurred} onChange={(e) => setOccurred(e.target.value)} />
          </label>
          <label>
            {x('Tab-separated result rows')}
            <textarea rows={6} value={reportText} onChange={(e) => setReportText(e.target.value)} />
          </label>
          <button
            disabled={!documentId || !reportText}
            onClick={() =>
              run(async () => {
                await staff('/staff/workbench/report-rows', {
                  patientId,
                  documentId,
                  occurredOn: occurred,
                  source: reportText,
                });
                setReportText('');
              })
            }
          >{x("Import for doctor verification")}</button>
        </fieldset>
      </details>
      <details
        open={activeArea === 'all'}
        hidden={activeArea !== 'all' && activeArea !== 'records'}
      >
        <summary>{x("Test results over time")}</summary>
        <p>{x("Only verified numeric results appear here. Reference limits come from the report, not from Sahayak. A value within those limits does not establish clinical normality.")}</p>
        {labs.length === 0 && <p>{x("No verified numeric results recorded.")}</p>}
        <table style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>{x("Test / date")}</th>
              <th>{x("Result")}</th>
              <th>{x("Report range")}</th>
              <th>{x("Previous matching result")}</th>
            </tr>
          </thead>
          <tbody>
            {labs.map((e: any) => {
              const previous = labs.find(
                (x: any) =>
                  x.id !== e.id &&
                  x.data.name.toLowerCase() === e.data.name.toLowerCase() &&
                  x.data.unit === e.data.unit &&
                  x.data.sample === e.data.sample &&
                  String(x.occurred_on) < String(e.occurred_on),
              );
              const d = e.data;
              const outside =
                (d.low !== undefined && d.value < d.low) ||
                (d.high !== undefined && d.value > d.high);
              return (
                <tr key={e.id}>
                  <td>
                    <a
                      href={`#entry-${e.id}`}
                      onClick={() => {
                        document
                          .getElementById(`entry-${e.id}`)
                          ?.closest('details')
                          ?.setAttribute('open', '');
                      }}
                    >
                      {d.name}
                    </a>{' '}
                    · {String(e.occurred_on).slice(0, 10)}
                  </td>
                  <td>
                    {d.value} {d.unit}
                    {outside ? ` · ${x('Outside report range')}` : ''}
                  </td>
                  <td>
                    {d.low ?? x('Not supplied')} – {d.high ?? x('Not supplied')}
                  </td>
                  <td>
                    {previous
                      ? `${previous.data.value} ${d.unit} (${String(previous.occurred_on).slice(0, 10)})`
                      : x('No earlier result with matching unit and sample/method')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
      <details
        open={activeArea === 'all'}
        hidden={activeArea !== 'all' && activeArea !== 'records'}
      >
        <summary>{x("Medicine record checks")}</summary>
        <p>{x(data.safety.limitations)}</p>
        {!data.safety.warnings.length && (
          <p>{x("No exact duplicate or exact allergy-name matches found in the verified records.")}</p>
        )}
        {data.safety.warnings.map((w: any, n: number) => (
          <p key={n} className="banner warn">
            {x(w.message)}{' '}
            {w.sourceIds.map((id: string) => (
              <a
                key={id}
                href={`#entry-${id}`}
                onClick={() =>
                  document
                    .getElementById(`entry-${id}`)
                    ?.closest('details')
                    ?.setAttribute('open', '')
                }
              >
                {x('Review record')}{' '}
              </a>
            ))}
          </p>
        ))}
      </details>
      <details open={activeArea === 'all'} hidden={activeArea !== 'all' && activeArea !== 'care'}>
        <summary>{x("Instructions to give the patient")}</summary>
        <p>{x("Prepare a copy from a signed note, edit it, then approve it. Hindi changes headings only; review or translate the doctor’s text yourself. No medical advice is added and nothing is sent automatically.")}</p>
        <fieldset disabled={busy}>
          <label>
            {x('Signed source note')}
            <select
              aria-label={x('Signed source note')}
              value={noteId}
              onChange={(e) => setNote(e.target.value)}
            >
              <option value="">{x("Choose signed note")}</option>
              {notes
                .filter((n) => n.status === 'signed')
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {new Date(n.signed_at).toLocaleString(uiLang === 'hi' ? 'hi-IN' : 'en-IN')}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {x('Instruction headings')}
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="en">{x("English")}</option>
              <option value="hi">{x("हिन्दी (review body language)")}</option>
            </select>
          </label>
          <button
            disabled={!noteId}
            onClick={() =>
              run(() =>
                staff('/staff/workbench/instruction-draft', { patientId, noteId, language }),
              )
            }
          >{x("Prepare instructions from note")}</button>
        </fieldset>
        {data.instructions.map((i: any) => (
          <article key={i.id} className="card">
            <b>
              {x(displayLabel(i.status))} ·{' '}
              {i.translated_from
                ? `${x('Translation draft language:')} ${x(i.language === 'hi' ? 'Hindi' : i.language === 'en' ? 'English' : i.language)}`
                : i.language === 'hi'
                  ? x('Hindi headings')
                  : x('English headings')}
            </b>{' '}
            · <a href={`#note-${i.note_id}`}>{x("Original signed note")}</a>
            {i.translation_source && (
              <details open={activeArea === 'all'}>
                <summary>{x("Original approved wording for translation review")}</summary>
                <p style={{ whiteSpace: 'pre-wrap' }}>{i.translation_source}</p>
                <p>{x("Check meaning, negations, medicine names, doses and units. Numeric checks do not prove translation accuracy.")}</p>
              </details>
            )}
            {i.status === 'draft' ? (
              <>
                <label>
                  {x('Instructions draft')}
                  <textarea
                    rows={8}
                    value={bodies[i.id] ?? i.body}
                    onChange={(e) => setBodies({ ...bodies, [i.id]: e.target.value })}
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      staff('/staff/workbench/instructions', {
                        id: i.id,
                        body: bodies[i.id] ?? i.body,
                        approve: false,
                      }),
                    )
                  }
                >{x("Save draft")}</button>{' '}
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        x('I checked these instructions and their language against the signed note. Approve for this patient?'),
                      )
                    )
                      void run(() =>
                        staff('/staff/workbench/instructions', {
                          id: i.id,
                          body: bodies[i.id] ?? i.body,
                          approve: true,
                        }),
                      );
                  }}
                >{x("Approve instructions")}</button>
              </>
            ) : (
              <>
                <p style={{ whiteSpace: 'pre-wrap' }}>{i.body}</p>
                <button onClick={() => download(i)}>{x("Download approved instructions")}</button>
                <label>
                  {x('Translate approved instructions into')}
                  <select
                    aria-label={x('Translate approved instructions into')}
                    defaultValue=""
                    onChange={(e) => {
                      const target = e.target.value;
                      e.target.value = '';
                      if (
                        target &&
                        confirm(
                          x('Send these approved instructions to the configured AI service for a translation draft? Review every medicine name, dose, warning and meaning before approving.'),
                        )
                      )
                        void run(() =>
                          staff('/staff/workbench/translate', {
                            id: i.id,
                            language: target,
                            consent: true,
                          }),
                        );
                    }}
                  >
                    <option value="">{x("Choose language")}</option>
                    {Object.entries({
                      en: 'English',
                      hi: 'Hindi',
                      hinglish: 'Hinglish',
                      mr: 'Marathi',
                      bn: 'Bengali',
                      ta: 'Tamil',
                      te: 'Telugu',
                      kn: 'Kannada',
                      gu: 'Gujarati',
                    }).map(([code, label]) => (
                      <option key={code} value={code}>
                        {x(label)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </article>
        ))}
      </details>
      <details open={activeArea === 'all'} hidden={activeArea !== 'all' && activeArea !== 'care'}>
        <summary>{x("Plan the next steps")}</summary>
        <p>{x("Prepare a sequence for this patient, then approve it. Due steps appear in your inbox. Contact is recorded manually until live messaging is connected. After contact, a reply is due within 48 hours; overdue replies return to the inbox.")}</p>
        <fieldset disabled={busy}>
          <label>
            {x('Plan name')}
            <input value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} />
          </label>
          <label>
            {x('Responsible doctor')}
            <select
              aria-label={x('Responsible doctor')}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="">{x("Choose doctor")}</option>
              {data.staff.map((u: any) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <p>
            {x('Start with a ready-made task:')}{' '}
            {['Check a requested report', 'Check referral completion', 'Check after a visit'].map(
              (title) => (
                <button
                  type="button"
                  key={title}
                  className="ghost small"
                  onClick={() => {
                    setPlanTitle(x(title));
                    setSteps([{ title: x(title), message: '', dueAt: '' }]);
                  }}
                >
                  {x(title)}
                </button>
              ),
            )}
          </p>
          {steps.map((step, n) => (
            <fieldset key={n}>
              <legend>{x('Step')} {n + 1}</legend>
              <label>
                {x('Task')}
                <input
                  value={step.title}
                  onChange={(e) =>
                    setSteps(steps.map((s, j) => (j === n ? { ...s, title: e.target.value } : s)))
                  }
                />
              </label>
              <label>
                {x('Approved wording for the patient')}
                <textarea
                  value={step.message}
                  onChange={(e) =>
                    setSteps(steps.map((s, j) => (j === n ? { ...s, message: e.target.value } : s)))
                  }
                />
              </label>
              <label>
                {x('When (your device time)')}
                <input
                  type="datetime-local"
                  value={step.dueAt}
                  onChange={(e) =>
                    setSteps(steps.map((s, j) => (j === n ? { ...s, dueAt: e.target.value } : s)))
                  }
                />
              </label>
              {steps.length > 1 && (
                <button onClick={() => setSteps(steps.filter((_, j) => j !== n))}>{x("Remove step")}</button>
              )}
            </fieldset>
          ))}
          <button
            disabled={steps.length >= 12}
            onClick={() => setSteps([...steps, { title: '', message: '', dueAt: '' }])}
          >{x("Add another step")}</button>{' '}
          <button
            disabled={!owner || !planTitle || steps.some((s) => !s.title || !s.message || !s.dueAt)}
            onClick={() =>
              run(async () => {
                await staff('/staff/workbench/plans', {
                  patientId,
                  title: planTitle,
                  assignedTo: owner,
                  steps: steps.map((s) => ({ ...s, dueAt: new Date(s.dueAt).toISOString() })),
                });
                setPlanTitle('');
                setSteps([{ title: '', message: '', dueAt: '' }]);
              })
            }
          >{x("Save plan for review")}</button>
        </fieldset>
        {data.plans.map((p: any) => (
          <article className="card" key={p.id}>
            <h4>
              {p.title} · {x(displayLabel(p.status))}
            </h4>
            <p>{x('Responsible:')} {p.assignee}</p>
            {['draft', 'paused'].includes(p.status) && (
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      x('I reviewed the wording and dates of every step. Activate this local follow-up plan?'),
                    )
                  )
                    if (data.steps.some((s: any) => s.plan_id === p.id && stepEdits[s.id]))
                      setError(x('Save edited steps before approving the plan.'));
                    else void planStatus(p.id, 'active');
                }}
              >
                {x(p.status === 'draft' ? 'Approve plan' : 'Resume plan')}
              </button>
            )}
            {p.status === 'active' && (
              <button disabled={busy} onClick={() => planStatus(p.id, 'paused')}>{x("Pause plan")}</button>
            )}
            {!['completed', 'cancelled'].includes(p.status) && (
              <>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (confirm(x('Cancel remaining steps in this plan?')))
                      void planStatus(p.id, 'cancelled');
                  }}
                >{x("Cancel plan")}</button>
                <button disabled={busy} onClick={() => planStatus(p.id, 'completed')}>{x("Close completed plan")}</button>
              </>
            )}
            {data.steps
              .filter((s: any) => s.plan_id === p.id)
              .map((s: any) => (
                <div key={s.id} style={{ borderTop: '1px solid var(--line)', padding: 8 }}>
                  <b>{s.title}</b> · {x(displayLabel(s.status))} · {x('due')}{' '}
                  {new Date(s.due_at).toLocaleString(uiLang === 'hi' ? 'hi-IN' : 'en-IN')}
                  {p.status === 'draft' ? (
                    <fieldset disabled={busy}>
                      <label>
                        {x('Patient step wording')}
                        <textarea
                          value={stepEdits[s.id]?.message ?? s.message}
                          onChange={(e) =>
                            setStepEdits({
                              ...stepEdits,
                              [s.id]: { ...stepEdits[s.id], message: e.target.value },
                            })
                          }
                        />
                      </label>
                      <label>
                        {x('Patient step date')}
                        <input
                          type="datetime-local"
                          value={
                            stepEdits[s.id]?.dueAt ??
                            new Date(
                              Date.parse(s.due_at) - new Date(s.due_at).getTimezoneOffset() * 60000,
                            )
                              .toISOString()
                              .slice(0, 16)
                          }
                          onChange={(e) =>
                            setStepEdits({
                              ...stepEdits,
                              [s.id]: { ...stepEdits[s.id], dueAt: e.target.value },
                            })
                          }
                        />
                      </label>
                      <button
                        disabled={!stepEdits[s.id]}
                        onClick={() =>
                          run(async () => {
                            await staff('/staff/workbench/step-edit', {
                              id: s.id,
                              title: s.title,
                              message: stepEdits[s.id]?.message ?? s.message,
                              dueAt: stepEdits[s.id]?.dueAt
                                ? new Date(stepEdits[s.id].dueAt).toISOString()
                                : s.due_at,
                            });
                            setStepEdits((prev) => {
                              const copy = { ...prev };
                              delete copy[s.id];
                              return copy;
                            });
                          })
                        }
                      >{x("Save patient step")}</button>
                    </fieldset>
                  ) : (
                    <p style={{ whiteSpace: 'pre-wrap' }}>{s.message}</p>
                  )}
                  {s.response && <p>{x('Recorded reply / review:')} {s.response}</p>}
                  {s.response_due_at && (
                    <p>
                      {x('Reply due:')} {new Date(s.response_due_at).toLocaleString(uiLang === 'hi' ? 'hi-IN' : 'en-IN')}
                      {s.status === 'contacted' && Date.parse(s.response_due_at) < Date.now()
                        ? ` · ${x('No reply recorded by deadline')}`
                        : ''}
                    </p>
                  )}
                  {p.status === 'active' && !['completed', 'cancelled'].includes(s.status) && (
                    <>
                      <label>
                        {x('Patient reply or doctor’s review')}
                        <textarea
                          value={replies[s.id] ?? ''}
                          onChange={(e) => setReplies({ ...replies, [s.id]: e.target.value })}
                        />
                      </label>
                      {['pending', 'no_response'].includes(s.status) && (
                        <button disabled={busy} onClick={() => stepStatus(s.id, 'contacted')}>
                          {s.status === 'no_response'
                            ? x('I contacted the patient again')
                            : x('I contacted the patient')}
                        </button>
                      )}{' '}
                      {s.status === 'contacted' &&
                        s.response_due_at &&
                        Date.parse(s.response_due_at) < Date.now() && (
                          <button disabled={busy} onClick={() => stepStatus(s.id, 'no_response')}>{x("Record no reply")}</button>
                        )}
                      <button disabled={busy} onClick={() => stepStatus(s.id, 'needs_review')}>{x("Needs doctor review")}</button>{' '}
                      <button
                        disabled={busy || !replies[s.id]?.trim()}
                        onClick={() => stepStatus(s.id, 'completed')}
                      >{x("Record review and finish step")}</button>
                    </>
                  )}
                  <details open={activeArea === 'all'}>
                    <summary>{x("Step history")}</summary>
                    {data.stepHistory
                      .filter((h: any) => h.step_id === s.id)
                      .map((h: any) => (
                        <p key={h.id}>
                          {new Date(h.created_at).toLocaleString(uiLang === 'hi' ? 'hi-IN' : 'en-IN')} · {x(h.source === 'patient_web' ? 'Patient reply' : displayLabel(h.status))} ·{' '}
                          {h.response || x('No reply recorded')}
                        </p>
                      ))}
                  </details>
                </div>
              ))}
          </article>
        ))}
      </details>
      <details open={activeArea === 'all'} hidden={activeArea !== 'all' && activeArea !== 'admin'}>
        <summary>{x("Clinic charges and payments")}</summary>
        <p>{x("Record charges and payments already received. This does not collect money or connect to a bank.")}</p>
        <fieldset disabled={busy}>
          <label>
            {x('Charge description')}
            <input value={chargeText} onChange={(e) => setChargeText(e.target.value)} />
          </label>
          <label>
            {x('Charge amount (INR)')}
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={chargeAmount}
              onChange={(e) => setChargeAmount(e.target.value)}
            />
          </label>
          <button
            disabled={!chargeText || Number(chargeAmount) <= 0}
            onClick={() =>
              run(async () => {
                await staff('/staff/workbench/charges', {
                  patientId,
                  description: chargeText,
                  amountPaise: Math.round(Number(chargeAmount) * 100),
                });
                setChargeAmount('');
              })
            }
          >{x("Record charge")}</button>
        </fieldset>
        {data.charges.map((c: any) => {
          const payment = payments[c.id];
          return (
            <article key={c.id} className="card">
              <b>{c.description}</b>{' '}
              {c.is_test && <strong>{x("Test only — excluded from real collections")}</strong>} ·{' '}
              {x(c.status === 'cancelled' ? 'Cancelled' : 'Recorded charge')}
              <p>
                {x('Charge')} ₹{(c.amount_paise / 100).toFixed(2)} · {x('Recorded paid')} ₹
                {(c.paid / 100).toFixed(2)} · {x('Outstanding')} ₹
                {(c.status === 'cancelled' ? 0 : (c.amount_paise - c.paid) / 100).toFixed(2)}
              </p>
              {c.status === 'open' && c.paid === 0 && (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        x('Cancel this mistaken or no longer needed charge? Its history will remain.'),
                      )
                    )
                      void run(() =>
                        staff('/staff/workbench/billing-correction', {
                          chargeId: c.id,
                          reason: 'entered_in_error',
                        }),
                      );
                  }}
                >{x("Cancel charge")}</button>
              )}
              {(data.payments ?? [])
                .filter((p: any) => p.charge_id === c.id)
                .map((p: any) => (
                  <p key={p.id}>
                    ₹{(p.amount_paise / 100).toFixed(2)} · {x(displayLabel(p.method))} ·{' '}
                    {new Date(p.created_at).toLocaleString(uiLang === 'hi' ? 'hi-IN' : 'en-IN')} ·{' '}
                    {x(p.voided_at ? 'Corrected entry — excluded from totals' : 'Recorded payment')}{' '}
                    {!p.voided_at && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              x('Mark this payment entry as a mistake? This changes recorded totals only. It does not refund money. Enter the correct payment separately.'),
                            )
                          )
                            void run(() =>
                              staff('/staff/workbench/billing-correction', {
                                chargeId: c.id,
                                paymentId: p.id,
                                reason: 'entered_in_error',
                              }),
                            );
                        }}
                      >{x("Correct mistaken entry")}</button>
                    )}
                  </p>
                ))}
              {c.status === 'open' && c.paid < c.amount_paise && (
                <fieldset disabled={busy}>
                  <label>
                    {x('Payment received (INR)')}
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={payment?.amount ?? ''}
                      onChange={(e) =>
                        setPayments({
                          ...payments,
                          [c.id]: {
                            amount: e.target.value,
                            method: payment?.method ?? 'cash',
                            requestId: newRequestId(),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    {x('Payment method')}
                    <select
                      value={payment?.method ?? 'cash'}
                      onChange={(e) =>
                        setPayments({
                          ...payments,
                          [c.id]: {
                            amount: payment?.amount ?? '',
                            method: e.target.value,
                            requestId: newRequestId(),
                          },
                        })
                      }
                    >
                      {['cash', 'card', 'upi', 'bank', 'other'].map((m) => (
                        <option key={m} value={m}>
                          {x(displayLabel(m))}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={!payment || Number(payment.amount) <= 0}
                    onClick={() => {
                      if (
                        payment &&
                        confirm(
                          x('Record money already received by the clinic? No money will be collected by Sahayak.'),
                        )
                      )
                        void run(async () => {
                          await staff('/staff/workbench/payments', {
                            chargeId: c.id,
                            requestId: payment.requestId,
                            amountPaise: Math.round(Number(payment.amount) * 100),
                            method: payment.method,
                          });
                          setPayments({
                            ...payments,
                            [c.id]: { amount: '', method: 'cash', requestId: newRequestId() },
                          });
                        });
                    }}
                  >{x("Record payment received")}</button>
                </fieldset>
              )}
            </article>
          );
        })}
      </details>
    </section>
  );
}
