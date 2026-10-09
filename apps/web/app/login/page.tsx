'use client';
import { useStaffLang } from '../../lib/staffText';
import { useState } from 'react';
import { api, session } from '../../lib/api';

export default function Login() {
  const { lang, setLang, x: ui } = useStaffLang();
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      const r = await api('/auth/login', { body: { email, password } });
      session.set(r);
      location.href =
        r.user.role === 'admin' ? '/admin' : r.user.role === 'doctor' ? '/doctor' : '/console';
    } catch (x: any) {
      setErr(x.message);
    }
  };
  return (
    <div className="wrap auth-page">
      <button className="ghost" type="button" onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}>{lang === 'hi' ? 'English' : 'हिन्दी'}</button>
      <a className="auth-brand" href="/">
        <span className="clinic-brand-mark" aria-hidden="true">
          ✚
        </span>{' '}
        {ui("Sahayak")}
      </a>
      <h1>{ui("Staff sign-in")}</h1>
      <p>{ui("Sign in to your Admin, Doctor, or Receptionist workspace.")}</p>
      <form className="card" onSubmit={submit}>
        <label htmlFor="email">{ui("Email")}</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
        <label htmlFor="pw">{ui("Password")}</label>
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
          <button type="submit">{ui("Sign in")}</button>
        </p>
        <p className="muted">
          {ui("New clinic?")} <a href="/signup">{ui("Set up your clinic")}</a>
        </p>
        <p className="muted">
          {ui("Demo: reception@demo.sahayak.in / anil@demo.sahayak.in, password demo1234")}
        </p>
      </form>
    </div>
  );
}
