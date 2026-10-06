'use client';
import { displayLabel } from '../../lib/labels';
import { useEffect, useState } from 'react';
import { staff } from '../../lib/api';
export function PrevisitBrief({
  patientId,
  onDocument,
  refreshKey,
  revision,
}: {
  patientId: string;
  onDocument: (id: string) => void;
  refreshKey?: unknown;
  revision?: number;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    setData(null);
    staff(`/staff/patients/${patientId}/brief`)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [patientId, refreshKey, revision]);
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Before the consultation</h2>
      <p className="muted">
        Patient information for your review, with links to the original records. Uploaded files are
        listed, not interpreted. Missing information is not a normal finding.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!data && !error && <p>Loading patient records…</p>}
      {data && (
        <>
          <div className="patient-facts">
            <div className="patient-fact">
              <small>Main concern</small>
              <strong>{data.concerns[0]?.reason || 'No concern recorded'}</strong>
            </div>
            <div className="patient-fact">
              <small>Active medicines</small>
              <strong>
                {(data.structured ?? [])
                  .filter((e: any) => e.kind === 'medication')
                  .map((e: any) => e.data.name)
                  .join(', ') || 'None verified'}
              </strong>
            </div>
            <div className="patient-fact">
              <small>Allergies</small>
              <strong>
                {(data.structured ?? [])
                  .filter((e: any) => e.kind === 'allergy')
                  .map((e: any) => e.data.substance)
                  .join(', ') || 'None recorded — confirm with patient'}
              </strong>
            </div>
            <div className="patient-fact">
              <small>Latest result</small>
              <strong>
                {data.labComparisons?.[0]?.current
                  ? `${data.labComparisons[0].current.data.name}: ${data.labComparisons[0].current.data.value} ${data.labComparisons[0].current.data.unit}`
                  : 'No verified result'}
              </strong>
            </div>
          </div>
          <details className="patient-source-details">
            <summary>Original sources and full history</summary>
            <h3>Verified patient facts</h3>
            <p>
              {(data.structured ?? []).filter((e: any) => e.kind === 'medication').length} active
              medicine records ·{' '}
              {(data.structured ?? []).filter((e: any) => e.kind === 'allergy').length} allergy
              records · {(data.pending ?? []).length} outstanding care tasks
            </p>
            <p>
              These counts only include recorded facts. No allergy entry does not confirm no
              allergies.
            </p>
            {(data.structured ?? [])
              .filter((e: any) => ['medication', 'allergy', 'diagnosis'].includes(e.kind))
              .map((e: any) => (
                <p key={e.id}>
                  <a
                    href={`#entry-${e.id}`}
                    onClick={() =>
                      document
                        .getElementById(`entry-${e.id}`)
                        ?.closest('details')
                        ?.setAttribute('open', '')
                    }
                  >
                    {e.kind === 'allergy'
                      ? `Recorded allergy: ${e.data.substance}`
                      : e.kind === 'medication'
                        ? `Medicine: ${e.data.name}`
                        : `Recorded diagnosis: ${e.data.name}`}
                  </a>{' '}
                  · {e.occurred_on}
                </p>
              ))}
            {(data.pending ?? []).map((t: any) => (
              <p key={t.id}>
                <a href="#care-tasks">{t.title}</a> · due {new Date(t.due_at).toLocaleDateString()}
              </p>
            ))}
            <h3>Latest verified results</h3>
            {(data.labComparisons ?? []).length === 0 && (
              <p>No verified numeric results recorded.</p>
            )}
            {(data.labComparisons ?? []).map(({ current: e, previous: p }: any) => (
              <p key={e.id}>
                <a
                  href={`#entry-${e.id}`}
                  onClick={() =>
                    document
                      .getElementById(`entry-${e.id}`)
                      ?.closest('details')
                      ?.setAttribute('open', '')
                  }
                >
                  {e.data.name}: {e.data.value} {e.data.unit}
                </a>{' '}
                · {e.occurred_on}
                {p
                  ? ` · previous ${p.data.value} ${p.data.unit} on ${p.occurred_on}`
                  : ' · no previous matching result'}
                {(e.data.low !== undefined && e.data.value < e.data.low) ||
                (e.data.high !== undefined && e.data.value > e.data.high)
                  ? ' · outside supplied report range'
                  : ''}
              </p>
            ))}
            <p>
              Comparisons match recorded test name, unit and sample/method; confirm comparability
              against the source.
            </p>
            <h3>Recorded concerns</h3>
            {!data.concerns.length && <p>No appointment concern recorded.</p>}
            {data.concerns.map((a: any) => (
              <details key={a.id}>
                <summary>
                  {new Date(a.starts_at).toLocaleDateString()} · {a.reason}
                </summary>
                <p>
                  Recorded appointment · {displayLabel(a.status)}. This is the recorded booking
                  reason.
                </p>
              </details>
            ))}
            <h3>Before-visit answers</h3>
            {!data.intake.length && <p>No before-visit answers recorded.</p>}
            {data.intake.map((i: any) => (
              <div key={i.id}>
                <a href={`#intake-${i.id}`}>
                  {new Date(i.created_at).toLocaleDateString()} · view original answers
                </a>
                {i.answers.map((a: any, n: number) => (
                  <p key={n}>
                    <b>{a.question}:</b> {a.answer}
                  </p>
                ))}
              </div>
            ))}
            <h3>Recent visits</h3>
            {!data.visits.length && <p>No visits recorded.</p>}
            {data.visits.map((v: any) => (
              <p key={v.id}>
                <a href={`#visit-${v.id}`}>
                  {String(v.queue_date).slice(0, 10)} · token {v.token_number} ·{' '}
                  {displayLabel(v.status)}
                </a>
              </p>
            ))}
            <h3>Previous signed notes</h3>
            {!data.notes.length && <p>No signed notes recorded.</p>}
            {data.notes.map((n: any) => (
              <div key={n.id}>
                <a href={`#note-${n.id}`}>
                  {new Date(n.signed_at).toLocaleDateString()} · {n.doctor} · original note
                </a>
                <p>{n.note.complaint || n.note.history || 'See original note for details.'}</p>
                {n.note.follow_up && <p>Recorded follow-up: {n.note.follow_up}</p>}
              </div>
            ))}
            <h3>Uploaded records</h3>
            {!data.documents.length && <p>No records uploaded.</p>}
            {data.documents.map((d: any) => (
              <p key={d.id}>
                <button className="small ghost" onClick={() => onDocument(d.id)}>
                  {d.filename}
                </button>{' '}
                · {new Date(d.created_at).toLocaleDateString()} · {displayLabel(d.status)}
                {d.caption && ` · ${d.caption}`}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
