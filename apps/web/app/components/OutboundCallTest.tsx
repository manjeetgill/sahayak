'use client';
import { useEffect, useRef, useState } from 'react';
import { staff } from '../../lib/api';
export function OutboundCallTest() {
  const [data, setData] = useState<any>(null),
    [number, setNumber] = useState(''),
    [agree, setAgree] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const attempt = useRef('');
  async function load() {
    const d = await staff('/staff/agents/calling/outbound');
    setData(d);
    if (
      d.calls.some(
        (c: any) => c.id === attempt.current && ['completed', 'failed'].includes(c.status),
      )
    )
      attempt.current = '';
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h3>Have the assistant call your phone</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p>{data?.message ?? 'Checking outbound calling support…'}</p>
      {data?.ready && (
        <>
          <label>
            Approved test phone
            <select
              value={number}
              onChange={(e) => {
                setNumber(e.target.value);
                attempt.current = '';
                setAgree(false);
              }}
            >
              <option value="">Choose your test number</option>
              {data.numbers.map((n: string) => (
                <option value={n} key={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I
            control this phone, want an AI test call now, and accept the provider’s call charges.
          </label>
          <button
            disabled={busy || !agree || !number}
            onClick={() =>
              void run(async () => {
                if (!attempt.current) attempt.current = crypto.randomUUID();
                await staff('/staff/agents/calling/outbound', {
                  requestId: attempt.current,
                  destination: number,
                  ownsNumber: true,
                  acceptsCharges: true,
                });
                setAgree(false);
              })
            }
          >
            Call my test phone
          </button>
        </>
      )}
      <p>
        <button className="ghost" disabled={busy} onClick={() => void run(load)}>
          Refresh outgoing-call connection
        </button>
      </p>
      <p>
        Calls require an authorized telephone provider. A submitted request does not prove that the
        phone rang or that audio worked. Calls with uncertain status are not automatically retried.
      </p>
      {data?.calls.map((c: any) => (
        <div className="card" key={c.id}>
          <p>
            Phone ending {c.last_four} ·{' '}
            <strong>
              {c.status === 'submitting'
                ? 'Requesting call'
                : c.status === 'accepted'
                  ? 'Requested'
                  : c.status === 'unknown'
                    ? 'Needs provider review'
                    : c.status}
            </strong>{' '}
            · {new Date(c.created_at).toLocaleString()}
          </p>
          {c.detail && <p>{c.detail}</p>}
          <button
            disabled={busy}
            className="ghost"
            onClick={() =>
              void run(() => staff(`/staff/agents/calling/outbound/${c.id}/refresh`, {}))
            }
          >
            Check this call
          </button>
        </div>
      ))}
    </section>
  );
}
