'use client';
import { PatientCheckins } from '../../../components/PatientCheckins';
import { displayLabel } from '../../../../lib/labels';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API, session, staff, useSession } from '../../../../lib/api';
import { PrevisitBrief } from '../../../components/PrevisitBrief';
import { ClinicalWorkspace } from '../../../components/ClinicalWorkspace';
import { CareTasks } from '../../../components/CareTasks';
import { useSection } from '../../../components/useSection';
import { VisitChecklist } from '../../../components/VisitChecklist';
import { IssuedDocs } from '../../../components/IssuedDocs';
import { QuickFollowupPlan } from '../../../components/QuickFollowupPlan';
import { useStaffLang } from '../../../../lib/staffText';
import { SymptomPicker } from '../../../components/SymptomPicker';
import { ConversationCapture } from '../../../components/ConversationCapture';

function patientSection(hash: string) {
  if (hash === 'note-composer' || hash.startsWith('note-')) return 'visit';
  if (hash === 'patient-administration' || hash === 'insurance-work' || hash === 'billing')
    return 'admin';
  if (hash === 'care-workspace' || hash === 'care-tasks' || hash === 'patient-follow-through')
    return 'care';
  if (
    hash === 'documents' ||
    hash.startsWith('entry-') ||
    hash.startsWith('visit-') ||
    hash.startsWith('intake-')
  )
    return 'records';
  return 'overview';
}
const FIELDS: [string, string][] = [
  ['complaint', 'Complaint'],
  ['history', 'History'],
  ['examination', 'Examination'],
  ['diagnosis', 'Diagnosis'],
  ['plan', 'Plan / advice'],
  ['follow_up', 'Follow-up'],
  ['assessment', 'Assessment'],
  ['differential', 'Possible diagnoses stated by doctor'],
  ['investigations', 'Tests requested'],
  ['instructions', 'Patient instructions'],
];
const fileToBase64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = rej;
    r.readAsDataURL(f);
  });

/** One patient's record: notes the scribe drafts and the doctor signs, uploaded reports, visits. Doctor only; every opening is logged. */
export default function PatientRecord({ params }: { params: { id: string } }) {
  const { x, lang: uiLang } = useStaffLang();
  const s = useSession('doctor');
  const selectedSection = useSection(patientSection, 'overview');
  const activeSection = s?.user.role === 'admin' ? 'all' : selectedSection;
  const [careVersion, setCareVersion] = useState(0);
  const [rec, setRec] = useState<any>(null),
    [err, setErr] = useState(''),
    [msg, setMsg] = useState('');
  const [text, setText] = useState(''),
    [lang, setLang] = useState<'en-IN' | 'hi-IN'>('en-IN'),
    [listening, setListening] = useState(false),
    [source, setSource] = useState<'typed' | 'dictated' | 'conversation'>('typed');
  const [captureConsentId, setCaptureConsentId] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [draft, setDraft] = useState<{
    id: string;
    note: Record<string, string>;
    flags: string[];
    transcript?: string;
  } | null>(null);
  const [tags, setTags] = useState('');
  const [patientLink, setPatientLink] = useState('');
  useEffect(() => setPatientLink(''), [params.id]);
  const [busy, setBusy] = useState(false);
  const recog = useRef<any>(null);
  const [shortcuts, setShortcuts] = useState<{
    templates: { id: string; name: string; body: string }[];
  } | null>(null);
  const [restored, setRestored] = useState(false);
  // Keep what the doctor has typed or dictated even if the page is closed or the connection drops.
  const draftKey = `sahayak.draft.${params.id}`;
  const [draftLoaded, setDraftLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        setText(saved);
        setRestored(true);
      }
    } catch {
      /* storage blocked: no autosave */
    }
    setDraftLoaded(true);
  }, [draftKey]);
  useEffect(() => {
    if (!draftLoaded) return;
    try {
      if (text.trim()) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    } catch {
      /* storage blocked: no autosave */
    }
  }, [text, draftKey, draftLoaded]);
  useEffect(() => {
    if (s)
      staff('/staff/shortcuts')
        .then(setShortcuts)
        .catch(() => {});
  }, [s]);

  const load = useCallback(async () => {
    const r = await staff(`/staff/patients/${params.id}/record`);
    setRec(r);
    setTags(r.patient.tags.join(', '));
    const d = r.notes.find(
      (n: any) => n.status === 'draft' && n.doctor_id === session.get()?.user.doctorId,
    );
    setDraft(
      (cur) =>
        cur ?? (d ? { id: d.id, note: d.note, flags: d.flags, transcript: d.transcript } : null),
    );
  }, [params.id]);
  useEffect(() => {
    if (s) load().catch((e) => setErr(e.message));
  }, [s, load]);
  useEffect(
    () => () => {
      recog.current?.abort();
    },
    [],
  );
  if (!s || !rec) return <div className="wrap">{err && <div className="error">{err}</div>}</div>;

  const run = async (fn: () => Promise<unknown>, ok = '') => {
    if (busy) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await fn();
      if (ok) setMsg(ok);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const dictate = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR)
      return setErr(
        'Voice dictation is not available in this browser. Type the note instead, or use Chrome.',
      );
    if (listening) {
      recog.current?.stop();
      return;
    }
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e: any) => {
      const t = Array.from(e.results)
        .slice(e.resultIndex)
        .map((x: any) => x[0].transcript)
        .join(' ');
      setText((cur) => `${cur} ${t}`.trim());
      setSource('dictated');
    };
    r.onerror = (e: any) => {
      setErr(`Dictation stopped: ${e.error}. You can keep typing.`);
      setListening(false);
    };
    r.onend = () => setListening(false);
    r.start();
    recog.current = r;
    setListening(true);
  };
  const arrange = () =>
    run(async () => {
      if (text.includes('___'))
        throw new Error('Fill in or delete the blanks (___) before arranging the note.');
      const out = await staff('/staff/notes/draft', {
        patientId: params.id,
        transcript: text,
        source,
        captureConsentId: source === 'conversation' ? captureConsentId : undefined,
        queueEntryId: rec.visits.find(
          (v: any) =>
            v.doctor_id === s.user.doctorId && ['called', 'in_consultation'].includes(v.status),
        )?.id,
      });
      setDraft({ id: out.noteId, note: out.note, flags: out.flags, transcript: text });
      setText('');
      setSource('typed');
      setCaptureConsentId('');
    });
  const openDoc = async (id: string) => {
    const res = await fetch(`${API}/staff/documents/${id}`, {
      headers: { authorization: `Bearer ${session.get()?.token}` },
    });
    if (!res.ok) return setErr('Could not open the file');
    window.open(URL.createObjectURL(await res.blob()), '_blank');
    load();
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    run(async () => {
      await staff(`/staff/patients/${params.id}/documents`, {
        filename: f.name,
        base64: await fileToBase64(f),
        kind: f.type.startsWith('image/') ? 'photo' : 'report',
      });
    }, 'Uploaded');
  };
  const p = rec.patient;
  const signed = rec.notes.filter((n: any) => n.status === 'signed');

  return (
    <div className="patient-page" data-patient-view={activeSection}>
      <div className="topbar">
        <b>{p.name}</b>
        <a href="/doctor">{x("← Back to doctor screen")}</a>
      </div>
      <div className="wrap" style={{ maxWidth: 860 }}>
        {err && (
          <div className="error" role="alert">
            {err}
          </div>
        )}
        {msg && (
          <div role="status" style={{ color: 'var(--ok)', fontWeight: 700 }}>
            {msg}
          </div>
        )}
        <div className="card patient-context-card">
          <div className="row between">
            <div>
              <h2 style={{ margin: 0 }}>{p.name}</h2>
              <span className="muted">
                {p.age ? `${p.age} ${x('years')} · ` : ''}
                {p.phone}
              </span>
            </div>
            <a className="button-link primary" href="#note-composer">{x("Continue visit")}</a>
          </div>
          {p.clinical_hold_until && (
            <p className="banner warn" style={{ margin: '8px 0' }}>
              {x('Erasure was requested. Signed records are kept until')}{' '}
              {String(p.clinical_hold_until).slice(0, 10)}, {x('then deleted automatically.')}
            </p>
          )}
          <details open={activeSection === 'all'} className="patient-groups">
            <summary>{x("Patient groups and reminders")}</summary>
            <label htmlFor="tags">{x("Patient groups (for reminders, e.g. diabetes)")}</label>
            <div className="row">
              <input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder={x('diabetes, bp')}
              />
              <button
                className="ghost"
                onClick={() =>
                  run(
                    () =>
                      staff(
                        `/staff/patients/${params.id}/tags`,
                        {
                          tags: tags
                            .split(',')
                            .map((x) => x.trim())
                            .filter(Boolean),
                        },
                        'PUT',
                      ),
                    x('Labels saved'),
                  )
                }
              >{x("Save")}</button>
            </div>
          </details>
          {rec.upcoming.length > 0 && (
            <p className="muted">
              {x('Next appointment:')}{' '}
              {new Date(rec.upcoming[0].starts_at).toLocaleString(uiLang === 'hi' ? 'hi-IN' : 'en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
          )}
          {s.user.role === 'doctor' && <details>
            <summary>{x("Give patient a private self-service link")}</summary>
            <p className="muted">{x("The patient can see their appointments and queue status, change a future visit, and upload a report. This link works for seven days. Creating another link cancels the previous one.")}</p>
            <button className="ghost" disabled={busy} onClick={() => void run(async () => {
              const result = await staff<{ path: string }>(`/staff/patients/${params.id}/access-link`, {});
              setPatientLink(`${location.origin}${result.path}`);
            })}>{x("Create private link")}</button>
            {patientLink && <div><label htmlFor="patient-private-link">{x("Give this link to the patient privately")}</label>
              <input id="patient-private-link" readOnly value={patientLink} onFocus={(e) => e.currentTarget.select()} />
              <button className="ghost small" onClick={() => void navigator.clipboard.writeText(patientLink)}>{x("Copy link")}</button>
            </div>}
          </details>}
        </div>

        <nav className="patient-section-tabs" aria-label={x('Patient record sections')}>
          <a
            href="#patient-overview"
            aria-current={activeSection === 'overview' ? 'page' : undefined}
          >{x("Overview")}</a>
          <a href="#note-composer" aria-current={activeSection === 'visit' ? 'page' : undefined}>{x("Visit")}</a>
          <a href="#care-workspace" aria-current={activeSection === 'care' ? 'page' : undefined}>{x("Care plan")}</a>
          <a href="#documents" aria-current={activeSection === 'records' ? 'page' : undefined}>{x("Records")}</a>
          <a
            href="#patient-administration"
            aria-current={activeSection === 'admin' ? 'page' : undefined}
          >{x("Documents & billing")}</a>
        </nav>

        <div className="patient-panels">
          <section
            id="patient-overview"
            hidden={activeSection !== 'all' && activeSection !== 'overview'}
          >
            {s.user.clinicAdmin && s.user.role === 'doctor' &&
              <QuickFollowupPlan patientId={params.id} doctorUserId={s.user.uid}
                onSaved={() => setCareVersion((value) => value + 1)} />}
            <PrevisitBrief
              patientId={params.id}
              onDocument={openDoc}
              refreshKey={rec}
              revision={careVersion}
            />
            <section className="card recent-history">
              <div className="panel-heading">
                <h2>{x("Recent history")}</h2>
                <a className="button-link" href="#documents">{x("Find in record")}</a>
              </div>
              {signed.slice(0, 3).map((n: any) => (
                <div className="prototype-task-row" key={n.id}>
                  <span className="task-signal" />
                  <div>
                    <strong>{x("Signed visit note")}</strong>
                    <small>
                      {new Date(n.signed_at).toLocaleDateString(uiLang === 'hi' ? 'hi-IN' : 'en-IN')} · {n.doctor}
                    </small>
                  </div>
                  <a className="button-link" href={`#note-${n.id}`}>{x("Open")}</a>
                </div>
              ))}
              {!signed.length && <p className="muted">{x("No signed visit notes recorded.")}</p>}
              {rec.documents.slice(0, 2).map((d: any) => (
                <div className="prototype-task-row" key={d.id}>
                  <span className="task-signal" />
                  <div>
                    <strong>{d.filename}</strong>
                    <small>{new Date(d.created_at).toLocaleDateString(uiLang === 'hi' ? 'hi-IN' : 'en-IN')}</small>
                  </div>
                  <button className="ghost small" onClick={() => void openDoc(d.id)}>{x("View report")}</button>
                </div>
              ))}
            </section>
          </section>
          <section
            id="patient-follow-through"
            hidden={activeSection !== 'all' && activeSection !== 'care'}
          >
            <CareTasks
              patientId={params.id}
              documents={rec.documents}
              onDocument={openDoc}
              queueEntryId={
                rec.visits.find(
                  (v: any) =>
                    v.doctor_id === s.user.doctorId &&
                    ['called', 'in_consultation'].includes(v.status),
                )?.id
              }
            />
          </section>
          <div
            className="card"
            style={{ marginTop: '1rem' }}
            hidden={activeSection !== 'all' && activeSection !== 'visit'}
            id="note-composer"
            data-testid="note-composer"
          >
            <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
              <h2>{x(draft ? 'Draft note' : 'New visit note')}</h2>
              {busy && <p role="status">{x("Saving or arranging your note…")}</p>}
              {!draft && (
                <>
                  <p className="muted">{x("Say or type what you found and decided. Headings help (\"Complaint: … Diagnosis: … Plan: …\"). The assistant only arranges your words; you review and sign.")}</p>
                  {source === 'conversation' && <p className="banner warn">{x('The microphone cannot identify speakers. Check the Doctor and Patient labels and correct the transcript before arranging it. Only your signed note becomes final.')}</p>}
                  <details className="muted note-safety-detail">
                    <summary>{x("How your note is handled")}</summary>
                    <p>{x("The assistant only arranges your words under headings and never adds anything. The draft is stored for review. Verify every section against your source before signing; unsigned drafts are not final clinical notes.")}</p>
                  </details>
                  <div
                    className="template-chips row"
                    style={{ flexWrap: 'wrap', gap: 6, margin: '6px 0' }}
                  >
                    <span className="muted">{x("Start from:")}</span>
                    {shortcuts?.templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="small ghost"
                        onClick={() =>
                          setText((cur) => (cur.trim() ? `${cur}\n${t.body}` : t.body))
                        }
                      >
                        {t.name}
                      </button>
                    ))}
                    <a href="/doctor/shortcuts" className="muted" style={{ fontSize: '.85rem' }}>
                      {x(shortcuts?.templates.length ? 'Manage' : 'Set up shortcuts')}
                    </a>
                  </div>
                  <SymptomPicker onAdd={(symptoms) => setText((current) => {
                    const line = source === 'conversation'
                      ? `Doctor: ${uiLang === 'hi' ? 'शिकायत: बताए गए लक्षण' : 'Complaint: Reported symptoms'}: ${symptoms.join(', ')}`
                      : `${uiLang === 'hi' ? 'शिकायत' : 'Complaint'}: ${symptoms.join(', ')}`;
                    return current.trim() ? `${current.trim()}\n${line}` : line;
                  })} />
                  <ConversationCapture patientId={params.id} canStart={!text.trim() && !draft}
                    onBegin={(id) => { setCaptureConsentId(id); setSource('conversation'); }}
                    onSegment={(speaker, words) => setText((current) =>
                      current.trim() ? `${current.trim()}\n${speaker}: ${words}` : `${speaker}: ${words}`)}
                    onRecordingChange={setCapturing}
                    onFinish={(hasTranscript) => { if (!hasTranscript) {
                      setSource('typed'); setCaptureConsentId('');
                    } }} />
                  {restored && (
                    <p className="muted" role="status">
                      {x('Restored what you had typed before.')}{' '}
                      <button
                        type="button"
                        className="small ghost"
                        onClick={() => {
                          setText('');
                          setRestored(false);
                        }}
                      >{x("Discard it")}</button>
                    </p>
                  )}
                  <textarea
                    aria-label={x('Dictation')}
                    rows={5}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      if (!listening && source !== 'conversation') setSource('typed');
                    }}
                    placeholder={x('Complaint: fever for 3 days. Diagnosis: viral fever. Plan: rest, fluids. Follow up: 1 week')}
                  />
                  <p className="row">
                    <button className={text.trim() ? 'ghost' : ''} type="button" onClick={dictate}
                      disabled={capturing || source === 'conversation'}>
                      {x(listening ? '■ Stop' : '🎤 Dictate')}
                    </button>
                    <select
                      aria-label={x('Dictation language')}
                      value={lang}
                      onChange={(e) => setLang(e.target.value as any)}
                      style={{ width: 'auto' }}
                    >
                      <option value="en-IN">{x("English")}</option>
                      <option value="hi-IN">हिन्दी</option>
                    </select>
                    <button
                      className={text.trim() ? '' : 'ghost'}
                      disabled={!text.trim() || listening || capturing}
                      onClick={arrange}
                    >{x("Arrange note")}</button>
                  </p>
                </>
              )}
              {draft && (
                <div className="note-review-grid">
                  <details open className="note-original">
                    <summary>{x("Original source transcript")}</summary>
                    <pre style={{ whiteSpace: 'pre-wrap' }}>
                      {draft.transcript ||
                        rec.notes.find((n: any) => n.id === draft.id)?.transcript ||
                        x('Source not available')}
                    </pre>
                  </details>
                  <div className="note-structured">
                    <p className="muted">{x("Check negation, measurements, doses you dictated, and section placement. Empty sections mean not stated. This does not create a prescription.")}</p>
                    {draft.flags.map((f, i) => (
                      <div
                        key={i}
                        className="banner warn"
                        style={{ margin: '6px 0' }}
                        role="status"
                      >
                        {f}
                      </div>
                    ))}
                    {FIELDS.map(([k, label]) => (
                      <div key={k}>
                        <label htmlFor={`f-${k}`}>{x(label)}</label>
                        <textarea
                          id={`f-${k}`}
                          rows={2}
                          value={draft.note[k] ?? ''}
                          onChange={(e) =>
                            setDraft({ ...draft, note: { ...draft.note, [k]: e.target.value } })
                          }
                        />
                      </div>
                    ))}
                    <p className="row">
                      <button
                        onClick={() =>
                          run(async () => {
                            await staff(`/staff/notes/${draft.id}`, { note: draft.note }, 'PATCH');
                            if (
                              confirm(
                                x('Sign this note? After signing it cannot be edited, only amended.'),
                              )
                            ) {
                              await staff(`/staff/notes/${draft.id}/sign`, {});
                              setDraft(null);
                            }
                          }, x('Saved'))
                        }
                      >{x("Save and sign")}</button>
                      <button
                        className="ghost"
                        onClick={() =>
                          run(
                            () => staff(`/staff/notes/${draft.id}`, { note: draft.note }, 'PATCH'),
                            x('Draft saved'),
                          )
                        }
                      >{x("Save draft")}</button>
                      <button
                        className="ghost"
                        onClick={() =>
                          confirm(x('Discard this draft?')) &&
                          run(async () => {
                            await staff(`/staff/notes/${draft.id}`, undefined, 'DELETE');
                            setDraft(null);
                          })
                        }
                      >{x("Discard")}</button>
                    </p>
                  </div>
                </div>
              )}
            </fieldset>
          </div>

          <div
            className="card"
            hidden={activeSection !== 'all' && activeSection !== 'visit'}
            style={{ marginTop: '1rem' }}
          >
            <h2>{x("Notes")}</h2>
            {!signed.length && <p className="muted">{x("No signed notes yet.")}</p>}
            <div className="list" data-testid="signed-notes">
              {signed.map((n: any) => (
                <div key={n.id} id={`note-${n.id}`}>
                  <div className="row between">
                    <b>
                      {new Date(n.signed_at).toLocaleString(uiLang === 'hi' ? 'hi-IN' : 'en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </b>
                    <span className="muted">
                      {n.doctor}
                      {n.amends_note_id ? ` · ${x('amends an earlier note')}` : ''}
                    </span>
                  </div>
                  {FIELDS.filter(([k]) => n.note[k]).map(([k, label]) => (
                    <div key={k}>
                      <span className="muted">{x(label)}: </span>
                      {n.note[k]}
                    </div>
                  ))}
                  {n.amend_reason && (
                    <div className="muted">{x('Reason for amendment:')} {n.amend_reason}</div>
                  )}
                  <button
                    className="small ghost"
                    onClick={() => {
                      const reason = prompt(x('Why is this note being corrected?'));
                      if (reason)
                        run(async () => {
                          const a = await staff(`/staff/notes/${n.id}/amend`, { reason });
                          setDraft({ id: a.noteId, note: n.note, flags: [] });
                          location.hash = 'note-composer';
                        });
                    }}
                  >{x("Amend")}</button>
                </div>
              ))}
            </div>
          </div>

          <section
            id="patient-administration"
            hidden={!['all', 'admin', 'visit'].includes(activeSection)}
          >
            <IssuedDocs patientId={params.id} />
          </section>

          <div
            className="card"
            style={{ marginTop: '1rem' }}
            id="documents"
            data-testid="documents"
            hidden={activeSection !== 'all' && activeSection !== 'records'}
          >
            <div className="row between">
              <h2>{x("Reports and photos")}</h2>
              <label
                className="ghost"
                style={{
                  cursor: 'pointer',
                  margin: 0,
                  padding: '.5rem .8rem',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                }}
              >
                {x('Upload / take photo')}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={(e) => upload(e.target.files?.[0])}
                />
              </label>
            </div>
            {!rec.documents.length && (
              <p className="muted">{x("Nothing uploaded. Patients can also send reports on WhatsApp.")}</p>
            )}
            <div className="list">
              {rec.documents.map((d: any) => (
                <div key={d.id} className="row between">
                  <span>
                    {d.filename} {d.status === 'new' && <span className="tag called">{x("New")}</span>}{' '}
                    <span className="muted">
                      · {x(displayLabel(d.uploaded_via))} · {new Date(d.created_at).toLocaleDateString(uiLang === 'hi' ? 'hi-IN' : 'en-IN')}
                      {d.caption ? ` · ${d.caption}` : ''}
                    </span>
                  </span>
                  <button className="small" onClick={() => openDoc(d.id)}>{x("Open")}</button>
                </div>
              ))}
            </div>
          </div>

          <ClinicalWorkspace
            activeArea={activeSection}
            onSaved={() => setCareVersion((v) => v + 1)}
            patientId={params.id}
            notes={rec.notes}
            documents={rec.documents}
            onDocument={openDoc}
          />
          <div
            className="card"
            hidden={activeSection !== 'all' && activeSection !== 'records'}
            style={{ marginTop: '1rem' }}
          >
            <h2>{x("Visits")}</h2>
            <div className="list">
              {rec.visits.map((v: any, i: number) => (
                <div key={i} id={`visit-${v.id}`}>
                  {String(v.queue_date).slice(0, 10)} · {x('token')} {v.token_number} ·{' '}
                  {x(displayLabel(v.status))}
                </div>
              ))}
              {!rec.visits.length && <p className="muted">{x("No visits yet.")}</p>}
            </div>
            {rec.intake.length > 0 && (
              <>
                <h3 style={{ marginTop: '1rem' }}>{x("Before-visit answers")}</h3>
                <div className="list">
                  {rec.intake.map((i: any, n: number) => (
                    <div key={n} id={`intake-${i.id}`}>
                      <span className="muted">{new Date(i.created_at).toLocaleDateString(uiLang === 'hi' ? 'hi-IN' : 'en-IN')}: </span>
                      {i.summary}
                      {(i.answers ?? []).map((a: any, index: number) => (
                        <p key={index}>
                          {a.question}: {a.answer}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <aside className="patient-tools workspace-stack">
          {activeSection === 'visit' ? (
            <details className="card checkin-responses-collapsed">
              <summary>{x("Earlier check-in responses")}</summary>
              <PatientCheckins patientId={params.id} />
            </details>
          ) : (
            <section className="card">
              <PatientCheckins patientId={params.id} />
            </section>
          )}
          <section className="card">
            <h2>{x(activeSection === 'visit' ? 'Finish this visit' : 'Visit checklist')}</h2>
            {rec.visits.find(
              (v: any) =>
                v.doctor_id === s.user.doctorId && ['called', 'in_consultation'].includes(v.status),
            ) ? (
              <VisitChecklist
                id={
                  rec.visits.find(
                    (v: any) =>
                      v.doctor_id === s.user.doctorId &&
                      ['called', 'in_consultation'].includes(v.status),
                  ).id
                }
                onFinished={() => void load()}
              />
            ) : (
              <p className="muted">{x("No active consultation recorded. Start the consultation from Today.")}</p>
            )}
          </section>
          <section className="card">
            <h2>{x("Quick actions")}</h2>
            <nav className="action-links">
              <a href="#note-composer">{x("Write or review note")}</a>
              <a href="#documents">{x("Upload report")}</a>
              <a href="#care-workspace">{x("Create follow-up plan")}</a>
              <a href="#patient-administration">{x("Documents & billing")}</a>
            </nav>
          </section>
        </aside>
      </div>
    </div>
  );
}
