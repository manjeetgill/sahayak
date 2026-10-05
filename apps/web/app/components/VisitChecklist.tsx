'use client';
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
