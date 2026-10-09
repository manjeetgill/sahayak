'use client';
import { AppointmentList } from '../components/AppointmentList';
import { useSection } from '../components/useSection';
import { displayLabel } from '../../lib/labels';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@sahayak/shared';
import { AskClinic } from '../components/AskClinic';
import { useStaffLang } from '../../lib/staffText';
import { beep, staff, useLive, useSession } from '../../lib/api';

const receptionSection = (hash: string) => (hash === 'conversations' ? 'conversations' : 'today');
export default function Console() {
  const s = useSession('receptionist');
  const { x, lang } = useStaffLang();
  const section = useSection(receptionSection, 'today');
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [queue, setQueue] = useState<any[]>([]),
    [flags, setFlags] = useState<any[]>([]),
    [convs, setConvs] = useState<any[]>([]),
    [doctors, setDoctors] = useState<any[]>([]);
  const [open, setOpen] = useState<string | null>(null),
    [thread, setThread] = useState<any[]>([]),
    [reply, setReply] = useState('');
  const selectedConversation = useRef<string | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(true);
  const [llmDown, setLlmDown] = useState(false),
    [err, setErr] = useState('');
  const [mc, setMc] = useState({ name: '', phone: '', doctorId: '', whatsapp: false });

  const load = useCallback(async () => {
    const [q, f, c] = await Promise.all([
      staff('/staff/queue'),
      staff('/staff/flags'),
      staff('/staff/conversations'),
    ]);
    setQueue(q);
    setFlags(f);
    if (
      selectedConversation.current &&
      !c.some((row: any) => row.id === selectedConversation.current)
    ) {
      const selected = await staff(`/staff/conversations/${selectedConversation.current}`).catch(
        () => null,
      );
      setConvs(selected ? [selected, ...c] : c);
    } else setConvs(c);
  }, []);
  const loadThread = useCallback(
    async (id: string) => setThread(await staff(`/staff/conversations/${id}/messages`)),
    [],
  );
  useEffect(() => {
    if (s) {
      load().catch(() => {});
      staff('/staff/doctors').then((d) => {
        setDoctors(d);
        setMc((m) => ({ ...m, doctorId: d[0]?.id ?? '' }));
      });
      staff('/staff/status')
        .then((r) => setLlmDown(r.llm.configured && !r.llm.ok))
        .catch(() => {});
    }
  }, [s, load]);
  useLive(s ? `/ws?token=${s.token}` : null, (e) => {
    if (e.type === 'flag_raised' && e.severity === 'urgent') beep();
    if (e.type === 'llm_status') setLlmDown(!e.ok);
    if (e.type === 'conversation_updated' && open === e.conversationId)
      loadThread(open).catch(() => {});
    load().catch(() => {});
  });
  if (!s) return null;
  const urgent = flags.filter((f) => f.severity === 'urgent');
  const act = async (fn: () => Promise<unknown>) => {
    setErr('');
    try {
      await fn();
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const openConv = async (id: string) => {
    setErr('');
    setThread([]);
    setOpen(null);
    try {
      const [conversation, messages] = await Promise.all([
        staff(`/staff/conversations/${id}`),
        staff(`/staff/conversations/${id}/messages`),
      ]);
      setConvs((previous) => [conversation, ...previous.filter((c) => c.id !== id)]);
      setThread(messages);
      selectedConversation.current = id;
      setOpen(id);
      location.hash = 'conversations';
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const cur = convs.find((c) => c.id === open);

  return (
    <div className="reception-page" data-reception-view={section}>
      <header className="screen-heading">
        <span className="eyebrow">{x('Reception')}</span>
        <h1>{x(section === 'conversations' ? 'Conversations' : 'Today at the front desk')}</h1>
        <p className="muted">
          {section === 'conversations'
            ? x('Messages that need a person or clinic review.')
            : x('Check in patients, manage the queue and answer clinic messages.')}
        </p>
        {section === 'today' ? (
          <button onClick={() => setCheckinOpen(true)}>{x('Check in patient')}</button>
        ) : (
          <button className="ghost" onClick={() => void act(load)}>
            {x('Refresh')}
          </button>
        )}
      </header>
      {section === 'today' && <AppointmentList token={s.token} />}
      {llmDown && (
        <div className="banner warn" role="status">
          {t(lang, 'console.llm_down')}
        </div>
      )}
      {urgent.map((f) => (
        <div key={f.id} className="banner urgent" role="alert">
          {t(lang, 'console.red_flag_alert')} — {f.summary}
        </div>
      ))}
      {err && (
        <div className="error" style={{ padding: '0 1rem' }}>
          {err}
        </div>
      )}

      <div className="reception-layout">
        <div className="reception-main" hidden={section !== 'today'}>
          <div className="card reception-queue">
            <h2>{t(lang, 'console.queue')}</h2>
            <div className="list">
              {queue
                .filter((q) => !['done', 'no_show', 'cancelled'].includes(q.status))
                .map((q) => (
                  <div key={q.id} className="row between">
                    <span>
                      <b>{q.token_number}</b> · {q.patient_name}{' '}
                      <span className={`tag ${q.status}`}>{x(displayLabel(q.status))}</span>{' '}
                      <span className="muted">{q.phone}</span>
                    </span>
                    <span className="row">
                      {q.status === 'called' && (
                        <button
                          className="small ghost"
                          onClick={() => act(() => staff(`/staff/queue/${q.id}/no-show`, {}))}
                        >
                          {x('No-show')}
                        </button>
                      )}
                      {['on_hold', 'skipped'].includes(q.status) && (
                        <button
                          className="small"
                          onClick={() => act(() => staff(`/staff/queue/${q.id}/resume`, {}))}
                        >
                          {x('Resume')}
                        </button>
                      )}
                      {q.status === 'waiting' && (
                        <button
                          className="small ghost"
                          onClick={() => act(() => staff(`/staff/queue/${q.id}/skip`, {}))}
                        >
                          {x('Skip')}
                        </button>
                      )}
                    </span>
                  </div>
                ))}
            </div>
            <button className="ghost" onClick={() => setCheckinOpen((v) => !v)}>
              {x('Add walk-in')}
            </button>
            <section hidden={!checkinOpen} className="walkin-form">
              <h3 style={{ marginTop: '1.2rem' }}>{t(lang, 'console.manual_checkin')}</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    await staff('/staff/checkin', {
                      name: mc.name || undefined,
                      phone: mc.phone,
                      doctorId: mc.doctorId,
                      consent: { visit_data: true, whatsapp_messaging: mc.whatsapp },
                    });
                    setMc({ ...mc, name: '', phone: '' });
                  });
                }}
              >
                <input
                  aria-label={x('Name')}
                  placeholder={x('Name')}
                  value={mc.name}
                  onChange={(e) => setMc({ ...mc, name: e.target.value })}
                  style={{ marginBottom: 6 }}
                />
                <input
                  aria-label={x('Phone')}
                  placeholder={x('Phone')}
                  value={mc.phone}
                  onChange={(e) => setMc({ ...mc, phone: e.target.value })}
                  required
                  style={{ marginBottom: 6 }}
                />
                <select
                  aria-label={x('Doctor')}
                  value={mc.doctorId}
                  onChange={(e) => setMc({ ...mc, doctorId: e.target.value })}
                  style={{ marginBottom: 6 }}
                >
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={mc.whatsapp}
                    onChange={(e) => setMc({ ...mc, whatsapp: e.target.checked })}
                  />
                  {x('Patient agreed to WhatsApp messages')}
                </label>
                <p className="muted">
                  {x('Recording this check-in confirms the patient agreed at the desk to the clinic storing their visit details.')}
                </p>
                <button type="submit">{x('Check in')}</button>
              </form>
            </section>
          </div>
          <div className="card">
            <h2>{x('Needs attention')} ({flags.length})</h2>
            <div className="list">
              {flags.map((f) => (
                <div key={f.id} className={`flag ${f.severity}`}>
                  <div className="row between">
                    <b>{x(displayLabel(f.kind))}</b>
                    <span className="muted">
                      {new Date(f.created_at).toLocaleTimeString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div>{f.summary}</div>
                  <div className="muted">{f.patient_name ?? ''}</div>
                  <div className="row" style={{ marginTop: 6 }}>
                    {f.conversation_id && (
                      <button className="small ghost" onClick={() => openConv(f.conversation_id)}>
                        {x('Review conversation')}
                      </button>
                    )}
                    {f.conversation_id && (
                      <button
                        className="small ghost"
                        onClick={() =>
                          act(async () => {
                            await staff(`/staff/conversations/${f.conversation_id}/takeover`, {
                              to: 'human',
                            });
                            await openConv(f.conversation_id);
                          })
                        }
                      >
                        {x('Reply myself')}
                      </button>
                    )}
                    <button
                      className="small"
                      onClick={() => act(() => staff(`/staff/flags/${f.id}/resolve`, {}))}
                    >
                      {x('Mark handled')}
                    </button>
                  </div>
                </div>
              ))}
              {!flags.length && <p className="muted">{x('Nothing needs attention.')}</p>}
            </div>
          </div>
          <section className="card">
            <div className="panel-heading">
              <h2>{x('Conversations needing a reply')}</h2>
              <a href="#conversations">{x('View all')}</a>
            </div>
            {convs
              .filter((c) => c.handled_by === 'human')
              .slice(0, 3)
              .map((c) => (
                <div className="prototype-task-row" key={c.id}>
                  <span className="task-signal" />
                  <div>
                    <strong>{c.patient_name ?? c.contact}</strong>
                    <small>{c.last_message || x('Waiting for a reply')}</small>
                  </div>
                  <button className="ghost small" onClick={() => void openConv(c.id)}>
                    {x('Reply')}
                  </button>
                </div>
              ))}
          </section>
        </div>
        <aside className="workspace-stack reception-aside" hidden={section !== 'today'}>
          <section className="card">
            <h2>{x('Today')}</h2>
            <div className="metric-grid">
              <div className="metric-tile">
                <strong>{queue.length}</strong>
                <span>{x('Checked in')}</span>
              </div>
              <div className="metric-tile">
                <strong>{queue.filter((q) => q.status === 'done').length}</strong>
                <span>{x('Seen')}</span>
              </div>
              <div className="metric-tile">
                <strong>{queue.filter((q) => q.status === 'waiting').length}</strong>
                <span>{x('Waiting')}</span>
              </div>
            </div>
          </section>
          <section className="card">
            <h2>{x('Quick actions')}</h2>
            <nav className="action-links">
              <a href="/console/arrivals">{x('QR arrivals & payments')}</a>
              <a href="/doctor/waitlist">{x('Waiting list')}</a>
              <a href="/console/privacy">{x('Privacy requests')}</a>

              <a href="/safety">{x('Safety report')}</a>
            </nav>
          </section>
          <AskClinic />
        </aside>
        <div
          className="conversation-workspace"
          id="conversations"
          hidden={section !== 'conversations'}
        >
          <section className="card conversation-list">
            <h2>{x('Conversations')}</h2>
            <label className="check">
              <input
                type="checkbox"
                checked={attentionOnly}
                onChange={(e) => setAttentionOnly(e.target.checked)}
              />
              {x('Needs attention only')}
            </label>
            <p className="muted">
              {x('Marking an alert as handled does not let the assistant reply again. Review the conversation first, then use Let the assistant reply.')}
            </p>
            <div className="list" style={{ maxHeight: 180, overflow: 'auto' }}>
              {convs
                .filter(
                  (c) =>
                    !attentionOnly ||
                    c.handled_by === 'human' ||
                    flags.some((f) => f.conversation_id === c.id),
                )
                .map((c) => (
                  <button
                    type="button"
                    className="ghost"
                    key={c.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => openConv(c.id)}
                  >
                    <span>
                      <b>{c.patient_name ?? c.contact}</b>{' '}
                      <span className={`tag ${c.handled_by === 'human' ? 'on_hold' : ''}`}>
                        {x(displayLabel(c.handled_by))}
                      </span>
                      <span className="muted">
                        {flags
                          .filter((f) => f.conversation_id === c.id)
                          .map((f) => x(displayLabel(f.kind)))
                          .join(' · ') ||
                          (c.handled_by === 'human'
                            ? x('Reception team is replying')
                            : x('Assistant is replying'))}
                        <br />
                        {(c.last_message ?? '').slice(0, 50)}
                      </span>
                    </span>
                  </button>
                ))}
            </div>
          </section>
          <section className="card selected-conversation">
            <h2>{x('Selected conversation')}</h2>
            {!cur && (
              <p className="muted">
                {x('Choose a conversation to read its original messages and reply.')}
              </p>
            )}
            {cur && (
              <>
                <hr />
                <div className="row between">
                  <b>{cur.patient_name ?? cur.contact}</b>
                  {cur.handled_by === 'agent' ? (
                    <button
                      className="small"
                      onClick={() =>
                        act(async () => {
                          await staff(`/staff/conversations/${cur.id}/takeover`, { to: 'human' });
                        })
                      }
                    >
                      {t(lang, 'console.takeover')}
                    </button>
                  ) : (
                    <button
                      className="small ghost"
                      onClick={() =>
                        act(async () => {
                          await staff(`/staff/conversations/${cur.id}/takeover`, { to: 'agent' });
                        })
                      }
                    >
                      {x('Let the assistant reply')}
                    </button>
                  )}
                </div>
                <div
                  style={{ maxHeight: 220, overflow: 'auto', margin: '.6rem 0' }}
                  data-testid="thread"
                >
                  {thread.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        textAlign: m.direction === 'in' ? 'left' : 'right',
                        margin: '.25rem 0',
                      }}
                    >
                      <span className="tag" style={{ whiteSpace: 'pre-wrap' }}>
                        {m.body}
                      </span>
                      <div className="muted" style={{ fontSize: '.7rem' }}>
                        {m.sender}
                      </div>
                    </div>
                  ))}
                </div>
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!reply.trim()) return;
                    const id = cur.id;
                    act(async () => {
                      await staff(`/staff/conversations/${id}/reply`, { text: reply });
                      setReply('');
                      await loadThread(id);
                    });
                  }}
                >
                  <input
                    aria-label={x('Reply')}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={x('Reply as receptionist')}
                  />
                  <button type="submit">{x('Send')}</button>
                </form>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
