'use client';
import { useEffect, useState } from 'react';
import { staff } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';

export function EveningUpdates() {
  const { x, lang } = useStaffLang();
  const [updates, setUpdates] = useState<any[]>([]);
  const [error, setError] = useState('');
  const detail: Record<string, string> = {
    live_delivery_unavailable: 'WhatsApp sending unavailable',
    evening_window_passed: 'The evening window passed',
    patient_needs_personal_review: 'Patient needs a personal review',
    consent_withdrawn: 'Patient stopped messages',
    evening_permission_withdrawn: 'Patient stopped evening messages',
    language_template_unavailable: 'Approved message is unavailable in the patient’s language',
    conversation_in_progress: 'Patient has another active conversation',
    demo_practice: 'Fictional demo reply; no WhatsApp sent',
  };
  const feeling: Record<string, string> = {
    better: 'Feeling better',
    same: 'About the same',
    worse: 'Feeling worse',
    help: 'Asked for help',
  };
  useEffect(() => {
    let active = true;
    const load = () =>
      staff('/staff/patient-checkins/evening-updates')
        .then((data) => {
          if (active) {
            setUpdates(data.updates);
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="card" aria-label={x('Evening check-ins')}>
      <h2>{x('Evening check-ins')}</h2>
      <p className="muted">
        {x(
          'See who was asked, who replied, and which messages could not be sent. A reply in the inbox still needs a person to review it.',
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!updates.length && !error && <p>{x('No evening check-ins scheduled yet.')}</p>}
      <div className="list">
        {updates.map((u) => (
          <div key={u.id} className="list-item">
            <strong>{u.patient_name}</strong> · {x('Evening')} {u.evening_number} ·{' '}
            {new Date(u.run_at).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN')}
            <p>
              {x(
                u.detail === 'demo_practice'
                  ? 'Practice example'
                  : u.delivered_at
                    ? 'WhatsApp delivery confirmed'
                    : u.status === 'pending'
                      ? 'Scheduled'
                      : u.status === 'sent'
                        ? 'Message submitted; delivery not verified'
                        : u.status === 'failed'
                          ? 'Could not send — contact patient yourself'
                          : 'Stopped or skipped',
              )}
              {u.detail ? ` · ${x(detail[u.detail] ?? 'Contact reception for details')}` : ''}
              {u.delivery_detail ? ` · ${u.delivery_detail}` : ''}
            </p>
            {u.replied_at && (
              <p>
                <b>{x('Patient replied:')}</b> {x(feeling[u.feeling] ?? 'Reply received')} —{' '}
                {u.message}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
