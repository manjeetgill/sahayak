'use client';
import { useState } from 'react';
import { api, session } from '../../lib/api';

export default function Login() {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      const r = await api('/auth/login', { body: { email, password } });
      session.set(r);
      location.href = r.user.role === 'doctor' ? '/doctor' : '/console';
    } catch (x: any) {
      setErr(x.message);
    }
  };
  return (
    <div className="wrap">
      <h1>Staff sign-in</h1>
      <form className="card" onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
        <label htmlFor="pw">Password</label>
        <input
          id="pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {err && (
          <div className="error" role="alert">
            {err}
          </div>
        )}
        <p>
          <button type="submit">Sign in</button>
        </p>
        <p className="muted">
          New clinic? <a href="/signup">Set up your clinic</a>
        </p>
        <p className="muted">
          Demo: reception@demo.sahayak.in / anil@demo.sahayak.in, password demo1234
        </p>
      </form>
    </div>
  );
}
