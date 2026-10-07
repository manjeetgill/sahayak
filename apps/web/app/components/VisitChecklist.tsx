'use client';
import { PatientCheckins } from './PatientCheckins';
import { displayLabel } from '../../lib/labels';
import { useState } from 'react';
import { staff } from '../../lib/api';
export function VisitChecklist({ id, onFinished }: { id: string; onFinished: () => void }) {
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
        Review and finish visit
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data && (
        <section className="card" aria-label="Visit completion checklist">
          <h3>Visit completion checklist</h3>
          <p>
            {data.signedNote
              ? 'Signed visit note recorded.'
              : 'No signed note linked to this visit.'}
          </p>
          <p>
            Notes still needing a signature:{' '}
            {data.notes.filter((n: any) => n.status === 'draft').length} · Draft
            certificates/prescriptions: {data.unsignedDocuments}
          </p>
          <p>
            Next booked appointment:{' '}
            {data.nextAppointment
              ? new Date(data.nextAppointment).toLocaleString()
              : 'Not recorded. Decide whether follow-up is needed.'}
          </p>
          <p>
            Instructions awaiting approval: {data.instructionDrafts} · Follow-up plans awaiting
            approval: {data.planDrafts} · Recorded entries needing verification:{' '}
            {data.unverifiedEntries}
          </p>
          <p>Outstanding tasks (including earlier visits):</p>
          {!data.tasks.length && (
            <p>
              No task requirements recorded. Confirm whether any documents or instructions are
              needed.
            </p>
          )}
          {data.tasks.map((t: any) => (
            <p key={t.id}>
              {t.title ?? t.kind} · {displayLabel(t.status)} · due{' '}
              {new Date(t.due_at).toLocaleDateString()}
            </p>
          ))}
          <a href={`/doctor/patients/${data.visit.patient_id}`}>
            Review notes, documents and follow-up tasks
          </a>
          <section className="card" aria-label="Feedback after this visit">
            <h3>Feedback after this visit</h3>
            {data.feedbackPlan?.state === 'ready' ? (
              <>
                <p>
                  Finishing this visit will automatically schedule a check-in for{' '}
                  <strong>
                    {new Date(data.feedbackPlan.scheduledAt).toLocaleString(undefined, {
                      timeZone: data.feedbackPlan.timezone,
                    })}{' '}
                    ({data.feedbackPlan.timezone})
                  </strong>
                  , assigned to {data.feedbackPlan.assignee}.
                </p>
                {!data.feedbackPlan.deliveryEnabled && (
                  <p>
                    WhatsApp invitations are paused. Your admin needs to enable delivery; the
                    check-in will still be scheduled.
                  </p>
                )}
              </>
            ) : (
              <p>
                {data.feedbackPlan?.state === 'existing'
                  ? 'A check-in already exists for this visit. No duplicate will be created.'
                  : data.feedbackPlan?.state === 'cancelled'
                    ? 'The check-in for this visit was cancelled. Finishing will not create it again.'
                    : data.feedbackPlan?.state === 'no_permission'
                      ? 'Feedback will not be scheduled: patient messaging and follow-up permission is missing.'
                      : data.feedbackPlan?.state === 'no_owner'
                        ? 'Feedback needs a responsible care staff member. Check your feedback settings.'
                        : 'Automatic feedback is off. Turn it on once in your feedback settings.'}
              </p>
            )}
            <a href="/doctor/checkins#settings" target="_blank" rel="noreferrer">
              Change my automatic feedback settings
            </a>
            <p className="muted">
              Reopen this checklist after changing settings to refresh this preview.
            </p>
          </section>
          <details>
            <summary>Schedule a different check-in for this patient</summary>
            <PatientCheckins patientId={data.visit.patient_id} visitId={id} />
          </details>
          <label className="check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed these items and any outstanding work has an owner.
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
            Finish visit
          </button>{' '}
          <button className="ghost" onClick={() => setData(null)}>
            Keep visit open
          </button>
        </section>
      )}
    </div>
  );
}
