'use client';
import { useState } from 'react';
import { api, session } from '../../lib/api';

/** Create a clinic (invite only). Leads straight into the guided setup. */
export default function Signup() {
  const [f, setF] = useState({
    inviteCode: '',
    clinicName: '',
    doctorName: '',
    adminName: '',
    email: '',
    password: '',
  });
  const [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api('/signup', { body: f });
      session.set(r);
      location.href = '/admin/setup';
    } catch (x: any) {
      setErr(x.message);
      setBusy(false);
    }
  };
  return (
    <div className="wrap auth-page">
      <a className="auth-brand" href="/">
        <span className="clinic-brand-mark" aria-hidden="true">
          ✚
        </span>{' '}
        Sahayak
      </a>
      <h1>Set up your clinic</h1>
      <p className="muted">
        Takes about 10 minutes. You will need your clinic address and opening hours.
      </p>
      <form className="card" onSubmit={submit}>
        <label htmlFor="invite">Invite code</label>
        <input
          id="invite"
          value={f.inviteCode}
          onChange={(e) => set('inviteCode', e.target.value)}
          required
        />
        <label htmlFor="cn">Clinic name</label>
        <input
          id="cn"
          value={f.clinicName}
          onChange={(e) => set('clinicName', e.target.value)}
          required
        />
        <label htmlFor="admin-name">Your name (clinic admin)</label>
        <input
          id="admin-name"
          value={f.adminName}
          onChange={(e) => set('adminName', e.target.value)}
          required
        />
        <label htmlFor="dn">First doctor’s name</label>
        <input
          id="dn"
          value={f.doctorName}
          onChange={(e) => set('doctorName', e.target.value)}
          required
        />
        <label htmlFor="em">Email (used to sign in)</label>
        <input
          id="em"
          type="email"
          value={f.email}
          onChange={(e) => set('email', e.target.value)}
          autoComplete="username"
          required
        />
        <label htmlFor="pw">Password (at least 10 characters)</label>
        <input
          id="pw"
          type="password"
          value={f.password}
          onChange={(e) => set('password', e.target.value)}
          autoComplete="new-password"
          minLength={10}
          required
        />
        {err && (
          <div className="error" role="alert">
            {err}
          </div>
        )}
        <p>
          <button type="submit" disabled={busy}>
            Create my clinic
          </button>
        </p>
        <p className="muted">
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </form>
    </div>
  );
}
