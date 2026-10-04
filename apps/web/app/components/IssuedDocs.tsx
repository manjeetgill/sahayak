'use client';
import { useCallback, useEffect, useState } from 'react';
import { API, session, staff } from '../../lib/api';

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const LABEL: Record<string, string> = {
  sick_leave: 'Sick-leave certificate',
  fitness: 'Fitness certificate',
  attendance: 'Attendance certificate',
  prescription: 'Prescription',
};

/** Certificates and prescriptions for one patient: the assistant drafts from the doctor's words, the doctor reviews and signs. */
export function IssuedDocs({ patientId, onChange }: { patientId: string; onChange?: () => void }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [err, setErr] = useState(''),
    [msg, setMsg] = useState('');
  const [mode, setMode] = useState<'' | 'sick_leave' | 'fitness' | 'attendance' | 'prescription'>(
    '',
  );
  const [f, setF] = useState<any>({
    from_date: today(),
    to_date: plusDays(2),
    remarks: '',
    include_diagnosis: false,
    diagnosis: '',
    purpose: '',
    confirm_fit: false,
    language: 'en',
    text: '',
  });
  const [signing, setSigning] = useState<any>(null),
    [pw, setPw] = useState(''),
    [ack, setAck] = useState(false);
  const [edit, setEdit] = useState<any>(null);

  const load = useCallback(async () => {
    setDocs((await staff(`/staff/patients/${patientId}/issued`)).documents);
  }, [patientId]);
  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);
  const run = async (fn: () => Promise<unknown>, ok = '') => {
    setErr('');
    setMsg('');
    try {
      await fn();
      if (ok) setMsg(ok);
      await load();
      onChange?.();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const create = () =>
    run(async () => {
      if (mode === 'prescription') {
        const r = await staff(`/staff/patients/${patientId}/prescriptions`, {
          text: f.text,
          language: f.language,
        });
        if (r.incomplete?.length) setMsg(`Please check: ${r.incomplete.join('; ')}`);
      } else {
        const content: any = { examined_on: today(), remarks: f.remarks || undefined };
        if (mode === 'sick_leave')
          Object.assign(content, {
            from_date: f.from_date,
            to_date: f.to_date,
            include_diagnosis: f.include_diagnosis,
            diagnosis: f.include_diagnosis ? f.diagnosis : undefined,
          });
        if (mode === 'fitness')
          Object.assign(content, { purpose: f.purpose || undefined, confirm_fit: f.confirm_fit });
        await staff(`/staff/patients/${patientId}/certificates`, {
          subtype: mode,
          content,
          language: f.language,
        });
      }
      setMode('');
      setF({ ...f, text: '' });
    });
  const openPdf = async (id: string) => {
    const res = await fetch(`${API}/staff/issued/${id}/pdf`, {
      headers: { authorization: `Bearer ${session.get()?.token}` },
    });
    if (!res.ok) return setErr('Could not open the PDF');
    window.open(URL.createObjectURL(await res.blob()), '_blank');
  };
  const doSign = () =>
    run(async () => {
      await staff(`/staff/issued/${signing.id}/sign`, { password: pw, acknowledgeWarnings: ack });
      setSigning(null);
      setPw('');
      setAck(false);
    }, 'Signed. You can now send it to the patient.');

  return (
    <div className="card" style={{ marginTop: '1rem' }} data-testid="issued-docs">
      <h2>Certificates and prescriptions</h2>
      <p className="muted">
        The assistant fills in a fixed template from your details, or copies the medicines you list.
        It never suggests a medicine, dose or diagnosis. Nothing reaches the patient until you sign.
      </p>
      {err && (
        <div className="error" role="alert">
          {err}
        </div>
      )}
      {msg && (
        <div role="status" style={{ color: 'var(--ok)', fontWeight: 600 }}>
          {msg}
        </div>
      )}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {(['sick_leave', 'fitness', 'attendance', 'prescription'] as const).map((m) => (
          <button
            key={m}
            className={mode === m ? '' : 'ghost'}
            onClick={() => setMode(mode === m ? '' : m)}
          >
            New {LABEL[m].toLowerCase()}
          </button>
        ))}
      </div>

      {mode && (
        <div style={{ marginTop: 10 }} data-testid="issue-form">
          {mode === 'sick_leave' && (
            <>
              <div className="row">
                <div style={{ flex: 1 }}>
                  <label htmlFor="df">From</label>
                  <input
                    id="df"
                    type="date"
                    value={f.from_date}
                    onChange={(e) => setF({ ...f, from_date: e.target.value })}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label htmlFor="dt">To</label>
                  <input
                    id="dt"
                    type="date"
                    value={f.to_date}
                    onChange={(e) => setF({ ...f, to_date: e.target.value })}
                  />
                </div>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={f.include_diagnosis}
                  onChange={(e) => setF({ ...f, include_diagnosis: e.target.checked })}
                />
                Show the diagnosis on the certificate (off by default, to protect the patient's
                privacy)
              </label>
              {f.include_diagnosis && (
                <input
                  aria-label="Diagnosis for certificate"
                  value={f.diagnosis}
                  onChange={(e) => setF({ ...f, diagnosis: e.target.value })}
                />
              )}
            </>
          )}
          {mode === 'fitness' && (
            <>
              <label htmlFor="pp">Fit for (e.g. "to resume work")</label>
              <input
                id="pp"
                value={f.purpose}
                onChange={(e) => setF({ ...f, purpose: e.target.value })}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={f.confirm_fit}
                  onChange={(e) => setF({ ...f, confirm_fit: e.target.checked })}
                />
                I examined the patient and found them medically fit
              </label>
            </>
          )}
          {mode === 'prescription' && (
            <>
              <label htmlFor="rx">Medicines, one per line, as you would dictate them</label>
              <textarea
                id="rx"
                rows={5}
                value={f.text}
                onChange={(e) => setF({ ...f, text: e.target.value })}
                placeholder={
                  'tab paracetamol 500 mg twice a day for 3 days\ntab cetirizine 10 mg at bedtime for 5 days\nadvice: rest and fluids\nfollow up after 5 days'
                }
              />
            </>
          )}
          {mode !== 'prescription' && (
            <>
              <label htmlFor="rm">Remarks (optional)</label>
              <input
                id="rm"
                value={f.remarks}
                onChange={(e) => setF({ ...f, remarks: e.target.value })}
              />
            </>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <label htmlFor="lg" style={{ margin: 0 }}>
              Language
            </label>
            <select
              id="lg"
              value={f.language}
              onChange={(e) => setF({ ...f, language: e.target.value })}
              style={{ width: 'auto' }}
            >
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
              <option value="both">Both</option>
            </select>
            <button disabled={mode === 'prescription' && !f.text.trim()} onClick={create}>
              Create draft
            </button>
          </div>
        </div>
      )}

      <div className="list" style={{ marginTop: 10 }}>
        {docs.map((d) => (
          <div key={d.id} data-testid={`doc-${d.status}`}>
            <div className="row between">
              <span>
                <b>{LABEL[d.subtype]}</b>{' '}
                {d.doc_number && <span className="muted">{d.doc_number}</span>}{' '}
                <span
                  className={`tag ${d.status === 'signed' ? 'called' : d.status === 'void' ? 'done' : 'on_hold'}`}
                >
                  {d.status}
                </span>
                {d.sent_at && <span className="muted"> · sent on WhatsApp</span>}
              </span>
              <span className="row">
                {d.status === 'draft' && (
                  <>
                    <button
                      className="small ghost"
                      onClick={() =>
                        setEdit(
                          edit?.id === d.id
                            ? null
                            : {
                                id: d.id,
                                content: JSON.parse(JSON.stringify(d.content)),
                                kind: d.kind,
                              },
                        )
                      }
                    >
                      Edit
                    </button>
                    <button className="small" onClick={() => setSigning(d)}>
                      Review and sign
                    </button>
                    <button
                      className="small ghost"
                      onClick={() =>
                        confirm('Discard this draft?') &&
                        run(() => staff(`/staff/issued/${d.id}`, undefined, 'DELETE'))
                      }
                    >
                      Discard
                    </button>
                  </>
                )}
                {d.status !== 'draft' && (
                  <button className="small ghost" onClick={() => openPdf(d.id)}>
                    PDF
                  </button>
                )}
                {d.status === 'signed' && (
                  <>
                    <button
                      className="small"
                      onClick={() =>
                        run(
                          () => staff(`/staff/issued/${d.id}/send`, {}),
                          'Sent to the patient on WhatsApp',
                        )
                      }
                    >
                      Send on WhatsApp
                    </button>
                    <button
                      className="small danger"
                      onClick={() => {
                        const r = prompt('Why is this document being withdrawn?');
                        if (r) run(() => staff(`/staff/issued/${d.id}/void`, { reason: r }));
                      }}
                    >
                      Withdraw
                    </button>
                  </>
                )}
              </span>
            </div>
            {d.kind === 'prescription' && (
              <div className="muted" style={{ fontSize: '.85rem' }}>
                {(d.content.items ?? [])
                  .map((i: any) =>
                    [i.form, i.drug, i.strength, i.frequency, i.duration].filter(Boolean).join(' '),
                  )
                  .join(' · ')}
              </div>
            )}
            {d.status === 'draft' &&
              d.warnings?.map((w: string, i: number) => (
                <div key={i} className="banner warn" style={{ margin: '4px 0' }} role="status">
                  {w}
                </div>
              ))}
            {edit?.id === d.id && (
              <div style={{ marginTop: 6 }}>
                {edit.kind === 'prescription' ? (
                  <>
                    {(edit.content.items ?? []).map((it: any, n: number) => (
                      <div key={n} className="row" style={{ margin: '3px 0', flexWrap: 'wrap' }}>
                        {(
                          [
                            'drug',
                            'strength',
                            'dose',
                            'frequency',
                            'duration',
                            'instructions',
                          ] as const
                        ).map((k) => (
                          <input
                            key={k}
                            aria-label={`${k} ${n + 1}`}
                            placeholder={k}
                            value={it[k] ?? ''}
                            onChange={(e) => {
                              const items = [...edit.content.items];
                              items[n] = { ...it, [k]: e.target.value || undefined };
                              setEdit({ ...edit, content: { ...edit.content, items } });
                            }}
                            style={{ flex: '1 1 110px' }}
                          />
                        ))}
                        <button
                          className="small ghost"
                          onClick={() =>
                            setEdit({
                              ...edit,
                              content: {
                                ...edit.content,
                                items: edit.content.items.filter((_: any, j: number) => j !== n),
                              },
                            })
                          }
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <input
                      aria-label="Advice"
                      placeholder="Advice"
                      value={edit.content.advice ?? ''}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          content: { ...edit.content, advice: e.target.value || undefined },
                        })
                      }
                      style={{ marginTop: 4 }}
                    />
                    <input
                      aria-label="Follow-up"
                      placeholder="Follow-up"
                      value={edit.content.follow_up ?? ''}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          content: { ...edit.content, follow_up: e.target.value || undefined },
                        })
                      }
                      style={{ marginTop: 4 }}
                    />
                  </>
                ) : (
                  <>
                    <div className="row">
                      <input
                        aria-label="Leave from"
                        type="date"
                        value={edit.content.from_date ?? ''}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            content: { ...edit.content, from_date: e.target.value || undefined },
                          })
                        }
                      />
                      <input
                        aria-label="Leave to"
                        type="date"
                        value={edit.content.to_date ?? ''}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            content: { ...edit.content, to_date: e.target.value || undefined },
                          })
                        }
                      />
                    </div>
                    <input
                      aria-label="Remarks"
                      placeholder="Remarks"
                      value={edit.content.remarks ?? ''}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          content: { ...edit.content, remarks: e.target.value || undefined },
                        })
                      }
                      style={{ marginTop: 4 }}
                    />
                  </>
                )}
                <p>
                  <button
                    className="small"
                    onClick={() =>
                      run(async () => {
                        await staff(`/staff/issued/${d.id}`, { content: edit.content }, 'PATCH');
                        setEdit(null);
                      }, 'Draft updated')
                    }
                  >
                    Save draft
                  </button>
                </p>
              </div>
            )}
          </div>
        ))}
        {!docs.length && <p className="muted">Nothing issued yet.</p>}
      </div>

      {signing && (
        <div
          className="card"
          style={{
            position: 'fixed',
            inset: '20% 10% auto',
            maxWidth: 520,
            margin: '0 auto',
            zIndex: 10,
            boxShadow: '0 10px 40px rgba(0,0,0,.3)',
          }}
          role="dialog"
          aria-label="Sign document"
          data-testid="sign-dialog"
        >
          <h3>Sign {LABEL[signing.subtype].toLowerCase()}</h3>
          <p className="muted">
            Your name and registration number go on the document. After signing it cannot be
            changed, only withdrawn.
          </p>
          {signing.warnings?.map((w: string, i: number) => (
            <div key={i} className="banner warn" style={{ margin: '4px 0' }}>
              {w}
            </div>
          ))}
          {signing.warnings?.length > 0 && (
            <label className="check">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I
              have checked these warnings
            </label>
          )}
          <label htmlFor="spw">Enter your password to sign</label>
          <input
            id="spw"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="current-password"
          />
          <p className="row">
            <button disabled={!pw || (signing.warnings?.length > 0 && !ack)} onClick={doSign}>
              Sign
            </button>
            <button
              className="ghost"
              onClick={() => {
                setSigning(null);
                setPw('');
              }}
            >
              Cancel
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
