'use client';
import { displayLabel } from '../../lib/labels';
import { useCallback, useEffect, useState } from 'react';
import { staff } from '../../lib/api';
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
      <h2>Reports, referrals and follow-through</h2>
      <p>
        Requested → received / prepared → doctor reviewed → patient informed. “Patient informed”
        records a communication you have completed; it does not send a message.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="ghost small" disabled={busy} onClick={() => run(load)}>
        Refresh tasks
      </button>
      {patientId && (
        <fieldset disabled={busy}>
          <legend>New task</legend>
          <label>
            Task type
            <select aria-label="Task type" value={kind} onChange={(e) => setKind(e.target.value)}>
              {['report', 'referral', 'document', 'followup', 'instructions'].map((k) => (
                <option key={k} value={k}>{displayLabel(k)}</option>
              ))}
            </select>
          </label>
          <label>
            Requested item
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="e.g. Obtain the report requested by the doctor"
            />
          </label>
          <label>
            Responsible doctor
            <select
              aria-label="Responsible doctor"
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
            Due date and time (your device time)
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
            Create task
          </button>
        </fieldset>
      )}
      {data?.tasks.length === 0 && <p>No tasks recorded.</p>}
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
            <b>{task.title}</b> <span className="tag">{displayLabel(task.status)}</span>
            {task.overdue && <strong className="error"> Overdue</strong>}
            <p>
              <a href={`/doctor/patients/${task.patient_id}#care-tasks`}>{task.patient_name}</a> ·{' '}
              {displayLabel(task.kind)} · {task.assignee || 'Unassigned'} · due{' '}
              {new Date(task.due_at).toLocaleString()}
            </p>
            {task.document_id && onDocument && (
              <p>
                <button className="small ghost" onClick={() => onDocument(task.document_id)}>
                  Open source report
                </button>
              </p>
            )}
            {patientId && next && (
              <>
                <label>
                  Reassign
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
                      Unassigned
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
                    Source report
                    <select
                      value={attachments[task.id] ?? ''}
                      onChange={(e) =>
                        setAttachments({ ...attachments, [task.id]: e.target.value })
                      }
                    >
                      <option value="">Select uploaded report</option>
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
                    ? 'Mark received / prepared'
                    : next === 'reviewed'
                      ? 'Confirm doctor review'
                      : 'Confirm patient was informed'}
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
                  Cancel task
                </button>
              </>
            )}
          </article>
        );
      })}
    </section>
  );
}
