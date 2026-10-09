'use client';
import { useState } from 'react';
import { staff } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';

export function QuickFollowupPlan({ patientId, doctorUserId, onSaved }: {
  patientId: string; doctorUserId: string; onSaved: () => void;
}) {
  const { x, lang } = useStaffLang();
  const [title, setTitle] = useState('');
  const [task, setTask] = useState('');
  const [message, setMessage] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [draftId, setDraftId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function create() {
    setError(''); setNotice('');
    if (!title.trim() || !task.trim() || !message.trim() || !dueAt || Date.parse(dueAt) <= Date.now()) {
      setError(x('Enter a plan name, task, patient wording, and a future date.')); return;
    }
    setBusy(true);
    try {
      const result = await staff<{ id: string }>('/staff/workbench/plans', {
        patientId, assignedTo: doctorUserId, title: title.trim(),
        steps: [{ title: task.trim(), message: message.trim(), dueAt: new Date(dueAt).toISOString() }],
      });
      setDraftId(result.id);
      setNotice(x('Draft saved. Review the wording and date, then approve it.'));
      onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function approve() {
    setBusy(true); setError('');
    try {
      await staff('/staff/workbench/plan-status', { id: draftId, status: 'active' });
      setNotice(x('Plan approved. The step is now in your work list when due. Contact is recorded manually until live messaging is connected.'));
      setDraftId(''); setTitle(''); setTask(''); setMessage(''); setDueAt(''); onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="card" aria-label={x('Personal follow-up plan')}>
    <h2>{x('Plan a personal follow-up')}</h2>
    <p className="muted">{x('Choose when to check back and write the exact wording yourself. You review and approve the plan before it becomes active. Sahayak reminds you when it is due.')}</p>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <fieldset disabled={busy || !!draftId}>
      <label>{x('Plan name')}<input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={x('Check after this visit')} /></label>
      <label>{x('What needs to happen?')}<input value={task} maxLength={200} onChange={(e) => setTask(e.target.value)} placeholder={x('Ask whether the requested report is ready')} /></label>
      <label>{x('Wording to use with the patient')}<textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={x('Write your own approved message')} /></label>
      <label>{x('When to follow up')}<input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></label>
      <button type="button" onClick={() => void create()}>{x('Save draft')}</button>
    </fieldset>
    {draftId && <div className="banner">
      <b>{x('Review before approval')}</b><p>{title} · {task} · {new Date(dueAt).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN')}</p><p>{message}</p>
      <button disabled={busy} onClick={() => void approve()}>{x('Approve this plan')}</button>{' '}
      <a href="#care-workspace">{x('Edit in full care plan')}</a>
    </div>}
  </section>;
}
