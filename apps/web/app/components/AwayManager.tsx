'use client';
import { useCallback, useEffect, useState } from 'react';
import { staff } from '../../lib/api';

type Leave = { id: string; startsOn: string; endsOn: string; note: string | null };
type Affected = { id: string; startsAt: string; patient: string | null; phone: string | null };

/** "I'm away": block new bookings for a date range, then deal with the bookings already in it, one by one. */
export function AwayManager({ doctorId }: { doctorId?: string }) {
  const [leave, setLeave] = useState<Leave[]>([]);
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [note, setNote] = useState('');
  const [affected, setAffected] = useState<Affected[] | null>(null);
  const [err, setErr] = useState('');
  const q = doctorId ? `?doctorId=${doctorId}` : '';
  const load = useCallback(async () => setLeave((await staff(`/staff/leave${q}`)).leave), [q]);
  useEffect(() => {
    if (doctorId !== '') load().catch((e) => setErr(e.message));
  }, [doctorId, load]);
  const run = async (fn: () => Promise<void>) => {
    setErr('');
    try {
      await fn();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const when = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="card" data-testid="away">
      <h2>I&apos;m away</h2>
      <p className="muted">
        New bookings are blocked on these days, including from the WhatsApp assistant. Patients who
        already have a booking are listed so you can decide about each one. Nobody is messaged
        automatically.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await staff('/staff/leave', {
              doctorId,
              startsOn: from,
              endsOn: to || from,
              note: note || undefined,
            });
            setAffected(r.affected);
            setFrom('');
            setTo('');
            setNote('');
            await load();
          });
        }}
      >
        <label>
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label>
          To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <input
          aria-label="Note (optional)"
          placeholder="Note (optional)"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="submit" disabled={!from || doctorId === ''}>
          Mark as away
        </button>
      </form>
      {err && (
        <div className="error" role="alert">
          {err}
        </div>
      )}
      {affected && (
        <div data-testid="away-affected" style={{ marginTop: '.8rem' }}>
          {affected.length === 0 ? (
            <p>Saved. Nobody had a booking on those days.</p>
          ) : (
            <>
              <p>
                <b>{affected.length}</b> patient(s) already have a booking on these days. Call or
                message them, then cancel the booking here:
              </p>
              <div className="list">
                {affected.map((a) => (
                  <div key={a.id} className="row between">
                    <span>
                      {a.patient ?? '—'} · {when(a.startsAt)}{' '}
                      <span className="muted">{a.phone}</span>
                    </span>
                    <button
                      className="small ghost"
                      onClick={() =>
                        run(async () => {
                          await staff(`/staff/appointments/${a.id}/cancel`, {});
                          setAffected((x) => (x ?? []).filter((y) => y.id !== a.id));
                        })
                      }
                    >
                      Cancel booking
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <h3 style={{ marginTop: '1rem' }}>Planned time away</h3>
      {leave.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <div className="list">
          {leave.map((l) => (
            <div key={l.id} className="row between">
              <span>
                {l.startsOn === l.endsOn ? l.startsOn : `${l.startsOn} to ${l.endsOn}`}{' '}
                <span className="muted">{l.note ?? ''}</span>
              </span>
              <button
                className="small ghost"
                onClick={() =>
                  run(
                    async () => (await staff(`/staff/leave/${l.id}`, undefined, 'DELETE'), load()),
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
