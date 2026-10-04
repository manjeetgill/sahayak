'use client';
import { useCallback, useEffect, useState } from 'react';
import { t } from '@sahayak/shared';
import { beep, session, staff, useLive, useSession } from '../../lib/api';

export default function Console() {
  const s = useSession('receptionist');
  const [queue, setQueue] = useState<any[]>([]),
    [flags, setFlags] = useState<any[]>([]),
    [convs, setConvs] = useState<any[]>([]),
    [doctors, setDoctors] = useState<any[]>([]);
  const [open, setOpen] = useState<string | null>(null),
    [thread, setThread] = useState<any[]>([]),
    [reply, setReply] = useState('');
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
    setConvs(c);
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
    setOpen(id);
    await loadThread(id);
  };
  const cur = convs.find((c) => c.id === open);

  return (
    <div>
      <div className="topbar">
        <b>{s.user.name}</b>{' '}
        <a href="/console/privacy" style={{ marginLeft: 16 }}>
          Privacy requests
        </a>
        <button
          className="ghost small"
          onClick={() => {
            session.clear();
            location.href = '/login';
          }}
        >
          Sign out
        </button>
      </div>
      {llmDown && (
        <div className="banner warn" role="status">
          {t('en', 'console.llm_down')}
        </div>
      )}
      {urgent.map((f) => (
        <div key={f.id} className="banner urgent" role="alert">
          {t('en', 'console.red_flag_alert')} — {f.summary}
        </div>
      ))}
      {err && (
        <div className="error" style={{ padding: '0 1rem' }}>
          {err}
        </div>
      )}
      <div className="grid3">
        <div className="card">
          <h2>{t('en', 'console.queue')}</h2>
          <div className="list">
            {queue
              .filter((q) => !['done', 'no_show', 'cancelled'].includes(q.status))
              .map((q) => (
                <div key={q.id} className="row between">
                  <span>
                    <b>{q.token_number}</b> · {q.patient_name}{' '}
                    <span className={`tag ${q.status}`}>{q.status}</span>{' '}
                    <span className="muted">{q.phone}</span>
                  </span>
                  <span className="row">
                    {q.status === 'called' && (
                      <button
                        className="small ghost"
                        onClick={() => act(() => staff(`/staff/queue/${q.id}/no-show`, {}))}
                      >
                        No-show
                      </button>
                    )}
                    {['on_hold', 'skipped'].includes(q.status) && (
                      <button
                        className="small"
                        onClick={() => act(() => staff(`/staff/queue/${q.id}/resume`, {}))}
                      >
                        Resume
                      </button>
                    )}
                    {q.status === 'waiting' && (
                      <button
                        className="small ghost"
                        onClick={() => act(() => staff(`/staff/queue/${q.id}/skip`, {}))}
                      >
                        Skip
                      </button>
                    )}
                  </span>
                </div>
              ))}
          </div>
          <h3 style={{ marginTop: '1.2rem' }}>{t('en', 'console.manual_checkin')}</h3>
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
              aria-label="Name"
              placeholder="Name"
              value={mc.name}
              onChange={(e) => setMc({ ...mc, name: e.target.value })}
              style={{ marginBottom: 6 }}
            />
            <input
              aria-label="Phone"
              placeholder="Phone"
              value={mc.phone}
              onChange={(e) => setMc({ ...mc, phone: e.target.value })}
              required
              style={{ marginBottom: 6 }}
            />
            <select
              aria-label="Doctor"
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
              Patient agreed to WhatsApp messages
            </label>
            <p className="muted">
              Recording this check-in confirms the patient agreed at the desk to the clinic storing
              their visit details.
            </p>
            <button type="submit">Check in</button>
          </form>
        </div>
        <div className="card">
          <h2>
            {t('en', 'console.flags')} ({flags.length})
          </h2>
          <div className="list">
            {flags.map((f) => (
              <div key={f.id} className={`flag ${f.severity}`}>
                <div className="row between">
                  <b>{f.kind.replace('_', ' ')}</b>
                  <span className="muted">
                    {new Date(f.created_at).toLocaleTimeString('en-IN', {
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
                      Open chat
                    </button>
                  )}
                  <button
                    className="small"
                    onClick={() => act(() => staff(`/staff/flags/${f.id}/resolve`, {}))}
                  >
                    Resolve
                  </button>
                </div>
              </div>
            ))}
            {!flags.length && <p className="muted">Nothing needs attention.</p>}
          </div>
        </div>
        <div className="card">
          <h2>Conversations</h2>
          <div className="list" style={{ maxHeight: 180, overflow: 'auto' }}>
            {convs.map((c) => (
              <div
                key={c.id}
                className="row between"
                style={{ cursor: 'pointer' }}
                onClick={() => openConv(c.id)}
              >
                <span>
                  <b>{c.patient_name ?? c.contact}</b>{' '}
                  <span className={`tag ${c.handled_by === 'human' ? 'on_hold' : ''}`}>
                    {c.handled_by}
                  </span>
                  <div className="muted">{(c.last_message ?? '').slice(0, 50)}</div>
                </span>
              </div>
            ))}
          </div>
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
                    {t('en', 'console.takeover')}
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
                    Hand back to assistant
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
                  aria-label="Reply"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Reply as receptionist"
                />
                <button type="submit">Send</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
