'use client';
import { displayLabel } from '../../../../lib/labels';
import { useEffect, useState } from 'react';
import { staff } from '../../../../lib/api';
export function Diagnostics({ phone = false }: { phone?: boolean }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  const load = async () => {
    setError('');
    try {
      setData(await staff('/staff/agents/diagnostics'));
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h3>{phone ? 'Phone activity' : 'Message delivery activity'}</h3>
      <button className="small ghost" onClick={() => void load()}>
        Refresh activity
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data &&
        (phone ? (
          <p>Live phone activity will be available once AI-Agent-Platform is connected.</p>
        ) : (
          <>
            <p>
              “Sent” means the messaging service accepted it. It does not confirm the patient received it. Dates show when the message was scheduled.
            </p>
            <p>
              {data.counts.map((c: any) => `${displayLabel(c.status)}: ${c.count}`).join(' · ') ||
                'No messages scheduled yet.'}
            </p>
            {data.messages.map((m: any) => (
              <div key={m.id} style={{ marginTop: 10 }}>
                <b>{displayLabel(m.status)}</b> · {m.attempts} attempt(s) · queued{' '}
                {new Date(m.created_at).toLocaleString()}
                {m.has_error && (
                  <p className="error">
                    The message could not be sent. Ask your setup team to check the messaging connection.
                  </p>
                )}
                {m.status === 'pending' && (
                  <p>
                    Next attempt: {new Date(m.next_attempt_at).toLocaleString()}. If overdue, check
                    with your setup team.
                  </p>
                )}
              </div>
            ))}
            <p>
              No activity after a real message? Ask your setup team to check the WhatsApp connection. Practice conversations do not send real messages.
            </p>
          </>
        ))}
    </section>
  );
}
