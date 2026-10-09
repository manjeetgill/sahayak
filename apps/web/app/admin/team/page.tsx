'use client';
import { useCallback, useEffect, useState } from 'react';
import { staff, useSession } from '../../../lib/api';
import { useStaffLang } from '../../../lib/staffText';
export default function Team() {
  const { x } = useStaffLang();
  const s = useSession('admin');
  const [people, setPeople] = useState<any[]>([]),
    [doctors, setDoctors] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'receptionist',
    doctorId: '',
  });
  const [doctor, setDoctor] = useState({ name: '', speciality: '' });
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([staff('/staff/team'), staff('/staff/doctors/all')]);
    setPeople(a.staff);
    setDoctors(b);
  }, []);
  useEffect(() => {
    if (s) load().catch((e) => setError(e.message));
  }, [s, load]);
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await load();
      setMessage(message);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!s) return null;
  return (
    <div className="wrap">
      <p className="eyebrow">{x("ADMIN")}</p>
      <h1>{x("Doctors & team")}</h1>
      <p>{x("Choose the right workspace for each person. Share their sign-in details privately.")}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <section className="card">
        <h2>{x("Current team")}</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{x("Name")}</th>
                <th>{x("Email")}</th>
                <th>{x("Workspace")}</th>
                <th>{x("Login")}</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.email}</td>
                  <td>
                    {x(p.role === 'admin' ? 'Admin' : p.role === 'doctor' ? 'Doctor' : 'Receptionist')}
                  </td>
                  <td>
                    {p.id === s.user.uid ? (
                      x('Your account')
                    ) : (
                      <button
                        className="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(`${x('Remove login for')} ${p.name}? ${x('They will no longer be able to sign in.')}`)
                          )
                            void run(
                              () => staff(`/staff/team/${p.id}`, undefined, 'DELETE'),
                              x('Login removed'),
                            );
                        }}
                      >{x("Remove login")}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="admin-cards">
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await staff('/staff/team', {
                ...form,
                doctorId: form.role === 'doctor' ? form.doctorId : undefined,
              });
              setForm({ ...form, name: '', email: '', password: '', doctorId: '' });
            }, x('Login created. Share the email and password privately.'));
          }}
        >
          <h2>{x("Create a login")}</h2>
          <label htmlFor="team-name">{x("Name")}</label>
          <input
            id="team-name"
            required
            minLength={2}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <label htmlFor="team-email">{x("Email")}</label>
          <input
            id="team-email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <label htmlFor="team-role">{x("Workspace")}</label>
          <select
            id="team-role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="receptionist">{x("Receptionist — appointments and front desk")}</option>
            <option value="doctor">{x("Doctor — consultations and patient care")}</option>
            <option value="admin">{x("Admin — clinic setup and connections")}</option>
          </select>
          {form.role === 'doctor' && (
            <>
              <label htmlFor="team-doctor">{x("Doctor profile")}</label>
              <select
                id="team-doctor"
                required
                value={form.doctorId}
                onChange={(e) => setForm({ ...form, doctorId: e.target.value })}
              >
                <option value="">{x("Choose a doctor")}</option>
                {doctors
                  .filter((d) => d.active)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </>
          )}
          <label htmlFor="team-password">{x("Password (at least 10 characters)")}</label>
          <input
            id="team-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <p>
            <button disabled={busy}>{x("Create login")}</button>
          </p>
        </form>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await staff('/staff/doctors', doctor);
              setDoctor({ name: '', speciality: '' });
            }, x('Doctor added. Create their login using the form alongside.'));
          }}
        >
          <h2>{x("Add a doctor profile")}</h2>
          <p>{x("Add the doctor here, then create their login.")}</p>
          <label htmlFor="doctor-name">{x("Doctor’s name")}</label>
          <input
            id="doctor-name"
            required
            minLength={2}
            value={doctor.name}
            onChange={(e) => setDoctor({ ...doctor, name: e.target.value })}
          />
          <label htmlFor="speciality">{x("Speciality")}</label>
          <input
            id="speciality"
            value={doctor.speciality}
            onChange={(e) => setDoctor({ ...doctor, speciality: e.target.value })}
          />
          <p>
            <button disabled={busy}>{x("Add doctor")}</button>
          </p>
          <h3>{x("Clinic doctors")}</h3>
          <ul>
            {doctors.map((d) => (
              <li key={d.id}>
                {d.name}
                {!d.active ? ' (inactive)' : ''}
              </li>
            ))}
          </ul>
        </form>
      </div>
    </div>
  );
}
