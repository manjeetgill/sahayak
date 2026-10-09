'use client';
import { displayLabel } from '../../lib/labels';
import { useCallback, useEffect, useState } from 'react';
import { staff } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';
export function CareTasks({
  patientId,
  queueEntryId,
  documents = [],
  onDocument,
}: {
  patientId?: string;
  queueEntryId?: string;
  documents?: any[];
  onDocument?: (id: string) => void;
}) {
  const { x, lang } = useStaffLang();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [title, setTitle] = useState(''),
    [kind, setKind] = useState('report'),
    [assignee, setAssignee] = useState(''),
    [due, setDue] = useState('');
  const [attachments, setAttachments] = useState<Record<string, string>>({});
  const load = useCallback(
    () =>
      staff(`/staff/care-tasks${patientId ? `?patientId=${patientId}` : ''}`).then((d) => {
        setData(d);
        setAssignee((a) => a || d.staff[0]?.id || '');
      }),
    [patientId],
  );
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" style={{ marginTop: 16 }} id="care-tasks">
      <h2>{x('Reports, referrals and follow-through')}</h2>
      <p>
        {x('Requested → received / prepared → doctor reviewed → patient informed. “Patient informed” records a communication you have completed; it does not send a message.')}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="ghost small" disabled={busy} onClick={() => run(load)}>
        {x('Refresh tasks')}
      </button>
      {patientId && (
        <fieldset disabled={busy}>
          <legend>{x('New task')}</legend>
          <label>
            {x('Task type')}
            <select aria-label={x('Task type')} value={kind} onChange={(e) => setKind(e.target.value)}>
              {['report', 'referral', 'document', 'followup', 'instructions'].map((k) => (
                <option key={k} value={k}>{x(displayLabel(k))}</option>
              ))}
            </select>
          </label>
          <label>
            {x('Requested item')}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={x('e.g. Obtain the report requested by the doctor')}
            />
          </label>
          <label>
            {x('Responsible doctor')}
            <select
              aria-label={x('Responsible doctor')}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              {data?.staff.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {x('Due date and time (your device time)')}
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <button
            disabled={title.trim().length < 3 || !due || !assignee}
            onClick={() =>
              run(async () => {
                await staff('/staff/care-tasks', {
                  patientId,
                  queueEntryId,
                  kind,
                  title,
                  assignedTo: assignee,
                  dueAt: new Date(due).toISOString(),
                });
                setTitle('');
              })
            }
          >
            {x('Create task')}
          </button>
        </fieldset>
      )}
      {data?.tasks.length === 0 && <p>{x('No tasks recorded.')}</p>}
      {data?.tasks.map((task: any) => {
        const next = (
          { requested: 'received', received: 'reviewed', reviewed: 'informed' } as Record<
            string,
            string
          >
        )[task.status];
        return (
          <article
            key={task.id}
            style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}
          >
            <b>{task.title}</b> <span className="tag">{x(displayLabel(task.status))}</span>
            {task.overdue && <strong className="error"> {x('Overdue')}</strong>}
            <p>
              <a href={`/doctor/patients/${task.patient_id}#care-tasks`}>{task.patient_name}</a> ·{' '}
              {x(displayLabel(task.kind))} · {task.assignee || x('Unassigned')} · {x('due')}{' '}
              {new Date(task.due_at).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN')}
            </p>
            {task.document_id && onDocument && (
              <p>
                <button className="small ghost" onClick={() => onDocument(task.document_id)}>
                  {x('Open source report')}
                </button>
              </p>
            )}
            {patientId && next && (
              <>
                <label>
                  {x('Reassign')}
                  <select
                    disabled={busy}
                    value={task.assigned_to ?? ''}
                    onChange={(e) =>
                      run(() =>
                        staff(
                          `/staff/care-tasks/${task.id}`,
                          { assignedTo: e.target.value },
                          'PATCH',
                        ),
                      )
                    }
                  >
                    <option value="" disabled>
                      {x('Unassigned')}
                    </option>
                    {data.staff.map((s: any) => (
                      <option value={s.id} key={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                {task.kind === 'report' && task.status === 'requested' && (
                  <label>
                    {x('Source report')}
                    <select
                      value={attachments[task.id] ?? ''}
                      onChange={(e) =>
                        setAttachments({ ...attachments, [task.id]: e.target.value })
                      }
                    >
                      <option value="">{x('Select uploaded report')}</option>
                      {documents.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.filename}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  disabled={
                    busy ||
                    (task.kind === 'report' && task.status === 'requested' && !attachments[task.id])
                  }
                  onClick={() =>
                    run(() =>
                      staff(
                        `/staff/care-tasks/${task.id}`,
                        { status: next, documentId: attachments[task.id] || undefined },
                        'PATCH',
                      ),
                    )
                  }
                >
                  {next === 'received'
                    ? x('Mark received / prepared')
                    : next === 'reviewed'
                      ? x('Confirm doctor review')
                      : x('Confirm patient was informed')}
                </button>{' '}
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      staff(`/staff/care-tasks/${task.id}`, { status: 'cancelled' }, 'PATCH'),
                    )
                  }
                >
                  {x('Cancel task')}
                </button>
              </>
            )}
          </article>
        );
      })}
    </section>
  );
}
