'use client';
import { useState } from 'react';
import { API, session, staff, useSession } from '../../../lib/api';

/** Desk privacy requests: a patient asks in person to see, take a copy of, or erase their data. */
export default function Privacy() {
  const s = useSession();
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState<any[] | null>(null);
  const [msg, setMsg] = useState(''),
    [err, setErr] = useState('');
  if (!s) return null;
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    try {
      setFound(
        await staff(`/staff/patients?phone=${encodeURIComponent(phone.replace(/[\s-]/g, ''))}`),
      );
    } catch (x: any) {
      setErr(x.message);
    }
  };
  const download = async (id: string) => {
    const sess = session.get();
    const res = await fetch(`${API}/staff/patients/${id}/export`, {
      headers: { authorization: `Bearer ${sess?.token}` },
    });
    if (!res.ok) return setErr('Could not download the patient’s information');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'patient-data.json';
    a.click();
    URL.revokeObjectURL(url);
    setMsg('Copy downloaded. Hand it to the patient securely.');
  };
  const erase = async (p: any) => {
    if (
      !confirm(
        `Permanently erase ${p.name}'s name, phone, chats and before-visit answers? This cannot be undone.`,
      )
    )
      return;
    try {
      await staff(`/staff/patients/${p.id}/erase`, {});
      setMsg('Erased.');
      setFound(null);
    } catch (x: any) {
      setErr(x.message);
    }
  };
  return (
    <div>
      <div className="topbar">
        <b>Patient information requests</b>
        <a href={s.user.role === 'doctor' ? '/doctor' : '/console'}>← Back</a>
      </div>
      <div className="wrap privacy-page">
        <header className="screen-heading">
          <span className="eyebrow">Reception</span>
          <h1>Patient information requests</h1>
        </header>
        <p className="muted">
          Use this when a patient asks, at the desk, for a copy of their data or for it to be
          erased. Patients can also do this themselves on WhatsApp ("my data", "delete my data",
          "STOP").
        </p>
        <div className="workspace-split">
          <div>
            <form className="card" onSubmit={search}>
              <label htmlFor="ph">Patient phone number</label>
              <input
                id="ph"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98XXXXXXXX"
              />
              <p>
                <button type="submit">Find patient</button>
              </p>
            </form>
            {msg && (
              <div role="status" style={{ color: 'var(--ok)', fontWeight: 700, marginTop: 8 }}>
                {msg}
              </div>
            )}
            {err && (
              <div className="error" role="alert">
                {err}
              </div>
            )}
            {found && (
              <div className="card" style={{ marginTop: 12 }}>
                {found.length === 0 && <p className="muted">No patient with that number.</p>}
                {found.map((p) => (
                  <div key={p.id} className="row between">
                    <span>
                      <b>{p.name}</b> · {p.phone}
                    </span>
                    <span className="row">
                      <button className="small ghost" onClick={() => download(p.id)}>
                        Download copy
                      </button>
                      <button className="small danger" onClick={() => erase(p)}>
                        Delete patient information
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <aside className="card">
            <h2>Patients can also message</h2>
            <p>
              “my data” to request a copy, “delete my data” to request erasure, or “STOP” to stop
              messages.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
