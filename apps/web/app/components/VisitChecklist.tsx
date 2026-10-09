'use client';
import { PatientCheckins } from './PatientCheckins';
import { displayLabel } from '../../lib/labels';
import { useState } from 'react';
import { staff } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';
export function VisitChecklist({ id, onFinished }: { id: string; onFinished: () => void }) {
  const { x, lang } = useStaffLang();
  const locale = lang === 'hi' ? 'hi-IN' : 'en-IN';
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const open = async () => {
    setError('');
    setBusy(true);
    setReviewed(false);
    try {
      setData(await staff(`/staff/queue/${id}/checklist`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <button disabled={busy} onClick={open}>
        {x('Review and finish visit')}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data && (
        <section className="card" aria-label={x('Visit completion checklist')}>
          <h3>{x('Visit completion checklist')}</h3>
          <p>
            {data.signedNote
              ? x('Signed visit note recorded.')
              : x('No signed note linked to this visit.')}
          </p>
          <p>
            {x('Notes still needing a signature:')}{' '}
            {data.notes.filter((n: any) => n.status === 'draft').length} · {x('Draft certificates/prescriptions:')} {data.unsignedDocuments}
          </p>
          <p>
            {x('Next booked appointment:')}{' '}
            {data.nextAppointment
              ? new Date(data.nextAppointment).toLocaleString(locale)
              : x('Not recorded. Decide whether follow-up is needed.')}
          </p>
          <p>
            {x('Instructions awaiting approval:')} {data.instructionDrafts} · {x('Follow-up plans awaiting approval:')} {data.planDrafts} · {x('Recorded entries needing verification:')}{' '}
            {data.unverifiedEntries}
          </p>
          <p>{x('Outstanding tasks (including earlier visits):')}</p>
          {!data.tasks.length && (
            <p>
              {x('No task requirements recorded. Confirm whether any documents or instructions are needed.')}
            </p>
          )}
          {data.tasks.map((t: any) => (
            <p key={t.id}>
              {t.title ?? x(displayLabel(t.kind))} · {x(displayLabel(t.status))} · {x('due')}{' '}
              {new Date(t.due_at).toLocaleDateString(locale)}
            </p>
          ))}
          <a href={`/doctor/patients/${data.visit.patient_id}`}>
            {x('Review notes, documents and follow-up tasks')}
          </a>
          <section className="card" aria-label={x('Feedback after this visit')}>
            <h3>{x('Feedback after this visit')}</h3>
            {data.feedbackPlan?.state === 'ready' ? (
              <>
                <p>
                  {x('Finishing this visit will automatically schedule a check-in for')}{' '}
                  <strong>
                    {new Date(data.feedbackPlan.scheduledAt).toLocaleString(locale, {
                      timeZone: data.feedbackPlan.timezone,
                    })}{' '}
                    ({data.feedbackPlan.timezone})
                  </strong>
                  , {x('assigned to')} {data.feedbackPlan.assignee}.
                </p>
                {!data.feedbackPlan.deliveryEnabled && (
                  <p>
                    {x('WhatsApp invitations are paused. Your admin needs to enable delivery; the check-in will still be scheduled.')}
                  </p>
                )}
              </>
            ) : (
              <p>
                {data.feedbackPlan?.state === 'existing'
                  ? x('A check-in already exists for this visit. No duplicate will be created.')
                  : data.feedbackPlan?.state === 'cancelled'
                    ? x('The check-in for this visit was cancelled. Finishing will not create it again.')
                    : data.feedbackPlan?.state === 'no_permission'
                      ? x('Feedback will not be scheduled: patient messaging and follow-up permission is missing.')
                      : data.feedbackPlan?.state === 'no_owner'
                        ? x('Feedback needs a responsible care staff member. Check your feedback settings.')
                        : x('Automatic feedback is off. Turn it on once in your feedback settings.')}
              </p>
            )}
            <a href="/doctor/checkins#settings" target="_blank" rel="noreferrer">
              {x('Change my automatic feedback settings')}
            </a>
            <p className="muted">
              {x('Reopen this checklist after changing settings to refresh this preview.')}
            </p>
          </section>
          <details>
            <summary>{x('Schedule a different check-in for this patient')}</summary>
            <PatientCheckins patientId={data.visit.patient_id} visitId={id} />
          </details>
          <label className="check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            {x('I reviewed these items and any outstanding work has an owner.')}
          </label>
          <button
            disabled={busy || !reviewed}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await staff(`/staff/queue/${id}/finish`, {});
                setData(null);
                onFinished();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {x('Finish visit')}
          </button>{' '}
          <button className="ghost" onClick={() => setData(null)}>
            {x('Keep visit open')}
          </button>
        </section>
      )}
    </div>
  );
}
