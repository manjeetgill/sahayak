'use client';
import { displayLabel } from '../../lib/labels';
import { useCallback, useEffect, useState } from 'react';
import { API, session, staff } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const LABEL: Record<string, string> = {
  sick_leave: 'Sick-leave certificate',
  fitness: 'Fitness certificate',
  attendance: 'Attendance certificate',
  prescription: 'Prescription',
};
type RxItem = { drug: string; strength: string; form: string; dose: string; frequency: string; duration: string; instructions: string };
const emptyRxItem = (drug: string): RxItem => ({ drug, strength: '', form: '', dose: '', frequency: '', duration: '', instructions: '' });

/** Certificates and prescriptions for one patient: the assistant drafts from the doctor's words, the doctor reviews and signs. */
export function IssuedDocs({ patientId, onChange }: { patientId: string; onChange?: () => void }) {
  const { x: ui } = useStaffLang();
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
  const [favs, setFavs] = useState<{ id: string; line: string }[]>([]);
  const [rxMode, setRxMode] = useState<'pick' | 'write'>('pick');
  const [rxItems, setRxItems] = useState<RxItem[]>([]);
  const [rxName, setRxName] = useState('');
  const [rxAdvice, setRxAdvice] = useState('');
  const [rxFollowUp, setRxFollowUp] = useState('');
  const [catalog, setCatalog] = useState<{ starter: string[]; custom: { id: string; name: string }[] }>({ starter: [], custom: [] });

  const load = useCallback(async () => {
    setDocs((await staff(`/staff/patients/${patientId}/issued`)).documents);
  }, [patientId]);
  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);
  useEffect(() => {
    staff('/staff/shortcuts')
      .then((r) => setFavs(r.medicines))
      .catch(() => {});
  }, []);
  const loadCatalog = useCallback(async () => {
    setCatalog(await staff('/staff/medicine-catalog'));
  }, []);
  useEffect(() => { void loadCatalog().catch((e) => setErr(e.message)); }, [loadCatalog]);
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

  /** "Same as last time": copies the last signed prescription into a new DRAFT for review. */
  const repeatLast = () =>
    run(async () => {
      const r = await staff(`/staff/patients/${patientId}/prescriptions/repeat`, {
        language: f.language,
      });
      setMode('');
      setMsg(
        `Copied from ${r.copiedFrom}. Review every line before signing.${r.warnings?.length ? ' Check the warnings below.' : ''}`,
      );
    });

  const create = () =>
    run(async () => {
      if (mode === 'prescription') {
        const r = await staff(`/staff/patients/${patientId}/prescriptions`, rxMode === 'pick'
          ? { content: {
              items: rxItems.map((item) => Object.fromEntries(
                Object.entries(item).filter(([, value]) => value.trim()),
              )),
              advice: rxAdvice.trim() || undefined,
              follow_up: rxFollowUp.trim() || undefined,
            }, language: f.language }
          : { text: f.text, language: f.language });
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
      setRxItems([]);
      setRxAdvice('');
      setRxFollowUp('');
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
      <h2 id="issued-documents">{ui("Certificates and prescriptions")}</h2>
      <p className="muted">{ui("The assistant fills in a fixed template from your details, or copies the medicines you list. It never suggests a medicine, dose or diagnosis. Nothing reaches the patient until you sign.")}</p>
      <p className="muted">{ui("Prescription warnings check patient-entered allergy words and exact names in doctor-verified medicine/allergy records. They do not check interactions, dose, therapeutic class, brand synonyms, age, pregnancy, kidney/liver function or missing records. No warning does not mean a prescription is safe.")}</p>
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
            {ui("New")} {ui(LABEL[m])}
          </button>
        ))}
      </div>

      {mode && (
        <div style={{ marginTop: 10 }} data-testid="issue-form">
          {mode === 'sick_leave' && (
            <>
              <div className="row">
                <div style={{ flex: 1 }}>
                  <label htmlFor="df">{ui("From")}</label>
                  <input
                    id="df"
                    type="date"
                    value={f.from_date}
                    onChange={(e) => setF({ ...f, from_date: e.target.value })}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label htmlFor="dt">{ui("To")}</label>
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
                {ui("Show the diagnosis on the certificate (off by default, to protect the patient's privacy)")}
              </label>
              {f.include_diagnosis && (
                <input
                  aria-label={ui("Diagnosis for certificate")}
                  value={f.diagnosis}
                  onChange={(e) => setF({ ...f, diagnosis: e.target.value })}
                />
              )}
            </>
          )}
          {mode === 'fitness' && (
            <>
              <label htmlFor="pp">{ui("Fit for (e.g. \"to resume work\")")}</label>
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
                {ui("I examined the patient and found them medically fit")}
              </label>
            </>
          )}
          {mode === 'prescription' && (
            <>
              <p className="muted">{ui('Choose medicines yourself and enter every instruction. Symptoms in the visit note do not select a medicine.')}</p>
              <div className="row">
                <button type="button" className={rxMode === 'pick' ? '' : 'ghost'} onClick={() => setRxMode('pick')}>{ui('Pick medicines')}</button>
                <button type="button" className={rxMode === 'write' ? '' : 'ghost'} onClick={() => setRxMode('write')}>{ui('Write medicine lines')}</button>
              </div>
              {rxMode === 'pick' ? <>
                <label htmlFor="rx-medicine-name">{ui('Find a medicine by generic name')}</label>
                <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <input id="rx-medicine-name" list="rx-medicine-list" value={rxName}
                    onChange={(e) => setRxName(e.target.value)} placeholder={ui('Search or type a medicine name')} />
                  <datalist id="rx-medicine-list">
                    {[...catalog.starter, ...catalog.custom.map((item) => item.name)].map((name) => <option key={name} value={name} />)}
                  </datalist>
                  <button type="button" disabled={!rxName.trim() || rxItems.length >= 20}
                    onClick={() => { setRxItems((items) => [...items, emptyRxItem(rxName.trim())]); setRxName(''); }}>
                    {ui('Add to draft')}
                  </button>
                  <button type="button" className="ghost" disabled={!rxName.trim()}
                    onClick={() => void run(async () => {
                      await staff('/staff/medicine-catalog', { name: rxName.trim() });
                      await loadCatalog();
                    }, ui('Saved to my medicine list'))}>{ui('Save name to my list')}</button>
                </div>
                <p className="muted">{ui('The starter list contains example generic names only. It does not show stock or recommend a medicine, strength or dose.')}{' '}
                  <a href="https://cdsco.mohfw.gov.in/opencms/opencms/en/consumer/Essential-Medicines/" target="_blank" rel="noreferrer">{ui('India essential medicines source')}</a>
                </p>
                {rxItems.map((item, index) => <fieldset key={index} style={{ margin: '10px 0', padding: 12 }}>
                  <legend>{index + 1}. {item.drug}</legend>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                    {([
                      ['drug', 'Medicine'], ['strength', 'Strength'], ['form', 'Form'], ['dose', 'Dose'],
                      ['frequency', 'How often'], ['duration', 'For how long'], ['instructions', 'Additional instructions'],
                    ] as [keyof RxItem, string][]).map(([key, label]) => <label key={key} style={{ flex: '1 1 145px' }}>
                      {ui(label)}{(['dose', 'frequency', 'duration'].includes(key) ? ' *' : '')}
                      <input value={item[key]} onChange={(e) => setRxItems((items) =>
                        items.map((it, n) => n === index ? { ...it, [key]: e.target.value } : it))} />
                    </label>)}
                  </div>
                  <button type="button" className="small ghost" onClick={() => setRxItems((items) => items.filter((_, n) => n !== index))}>{ui('Remove medicine')}</button>
                </fieldset>)}
                <label>{ui('Advice stated by doctor (optional)')}
                  <textarea rows={2} value={rxAdvice} onChange={(e) => setRxAdvice(e.target.value)} /></label>
                <label>{ui('Follow-up stated by doctor (optional)')}
                  <input value={rxFollowUp} onChange={(e) => setRxFollowUp(e.target.value)} /></label>
              </> : <>
              <label htmlFor="rx">{ui("Medicines, one per line, as you would dictate them")}</label>
              <textarea
                id="rx"
                rows={5}
                value={f.text}
                onChange={(e) => setF({ ...f, text: e.target.value })}
                placeholder={
                  'tab paracetamol 500 mg twice a day for 3 days\ntab cetirizine 10 mg at bedtime for 5 days\nadvice: rest and fluids\nfollow up after 5 days'
                }
              />
              <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                <button type="button" className="small ghost" onClick={repeatLast}>{ui("Repeat last prescription")}</button>
                {favs.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="small ghost"
                    title={ui("Add this line")}
                    onClick={() =>
                      setF((cur: any) => ({
                        ...cur,
                        text: cur.text.trim() ? `${cur.text}\n${m.line}` : m.line,
                      }))
                    }
                  >
                    + {m.line}
                  </button>
                ))}
                <a href="/doctor/shortcuts" className="muted" style={{ fontSize: '.85rem' }}>
                  {ui(favs.length ? 'Manage favourites' : 'Save favourite medicines')}
                </a>
              </div>
              </>}
            </>
          )}
          {mode !== 'prescription' && (
            <>
              <label htmlFor="rm">{ui("Remarks (optional)")}</label>
              <input
                id="rm"
                value={f.remarks}
                onChange={(e) => setF({ ...f, remarks: e.target.value })}
              />
            </>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <label htmlFor="lg" style={{ margin: 0 }}>{ui("Language")}</label>
            <select
              id="lg"
              value={f.language}
              onChange={(e) => setF({ ...f, language: e.target.value })}
              style={{ width: 'auto' }}
            >
              <option value="en">{ui("English")}</option>
              <option value="hi">हिन्दी</option>
              <option value="both">{ui("Both")}</option>
            </select>
            <button disabled={mode === 'prescription' && (rxMode === 'write' ? !f.text.trim()
              : !rxItems.length || rxItems.some((item) => !item.drug.trim() || !item.dose.trim() || !item.frequency.trim() || !item.duration.trim()))}
              onClick={create}>{ui("Create draft")}</button>
          </div>
        </div>
      )}

      <div className="list" style={{ marginTop: 10 }}>
        {docs.map((d) => (
          <div key={d.id} data-testid={`doc-${d.status}`}>
            <div className="row between">
              <span>
                <b>{ui(LABEL[d.subtype])}</b>{' '}
                {d.doc_number && <span className="muted">{d.doc_number}</span>}{' '}
                <span
                  className={`tag ${d.status === 'signed' ? 'called' : d.status === 'void' ? 'done' : 'on_hold'}`}
                >
                  {displayLabel(d.status)}
                </span>
                {d.sent_at && <span className="muted">{ui("· sent on WhatsApp")}</span>}
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
                    >{ui("Edit")}</button>
                    <button className="small" onClick={() => setSigning(d)}>{ui("Review and sign")}</button>
                    <button
                      className="small ghost"
                      onClick={() =>
                        confirm('Discard this draft?') &&
                        run(() => staff(`/staff/issued/${d.id}`, undefined, 'DELETE'))
                      }
                    >{ui("Discard")}</button>
                  </>
                )}
                {d.status !== 'draft' && (
                  <button className="small ghost" onClick={() => openPdf(d.id)}>{ui("PDF")}</button>
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
                    >{ui("Send on WhatsApp")}</button>
                    <button
                      className="small danger"
                      onClick={() => {
                        const r = prompt('Why is this document being withdrawn?');
                        if (r) run(() => staff(`/staff/issued/${d.id}/void`, { reason: r }));
                      }}
                    >{ui("Withdraw")}</button>
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
                      aria-label={ui("Advice")}
                      placeholder={ui("Advice")}
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
                      aria-label={ui("Follow-up")}
                      placeholder={ui("Follow-up")}
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
                        aria-label={ui("Leave from")}
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
                        aria-label={ui("Leave to")}
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
                      aria-label={ui("Remarks")}
                      placeholder={ui("Remarks")}
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
                  >{ui("Save draft")}</button>
                </p>
              </div>
            )}
          </div>
        ))}
        {!docs.length && <p className="muted">{ui("Nothing issued yet.")}</p>}
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
          aria-label={ui("Sign document")}
          data-testid="sign-dialog"
        >
          <h3>{ui("Sign")} {LABEL[signing.subtype].toLowerCase()}</h3>
          <p className="muted">{ui("Your name and registration number go on the document. After signing it cannot be changed, only withdrawn.")}</p>
          {signing.warnings?.map((w: string, i: number) => (
            <div key={i} className="banner warn" style={{ margin: '4px 0' }}>
              {w}
            </div>
          ))}
          {signing.warnings?.length > 0 && (
            <label className="check">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{ui("I have checked these warnings")}
            </label>
          )}
          <label htmlFor="spw">{ui("Enter your password to sign")}</label>
          <input
            id="spw"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="current-password"
          />
          <p className="row">
            <button disabled={!pw || (signing.warnings?.length > 0 && !ack)} onClick={doSign}>{ui("Sign")}</button>
            <button
              className="ghost"
              onClick={() => {
                setSigning(null);
                setPw('');
              }}
            >{ui("Cancel")}</button>
          </p>
        </div>
      )}
    </div>
  );
}
