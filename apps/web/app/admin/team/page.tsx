'use client';
import { useCallback, useEffect, useState } from 'react';
import { staff, useSession } from '../../../lib/api';
export default function Team() {
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
      <p className="eyebrow">ADMIN</p>
      <h1>Doctors &amp; team</h1>
      <p>Choose the right workspace for each person. Share their sign-in details privately.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <section className="card">
        <h2>Current team</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Workspace</th>
                <th>Login</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.email}</td>
                  <td>
                    {p.role === 'admin' ? 'Admin' : p.role === 'doctor' ? 'Doctor' : 'Receptionist'}
                  </td>
                  <td>
                    {p.id === s.user.uid ? (
                      'Your account'
                    ) : (
                      <button
                        className="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              `Remove ${p.name}’s login? They will no longer be able to sign in.`,
                            )
                          )
                            void run(
                              () => staff(`/staff/team/${p.id}`, undefined, 'DELETE'),
                              'Login removed',
                            );
                        }}
                      >
                        Remove login
                      </button>
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
            }, 'Login created. Share the email and password privately.');
          }}
        >
          <h2>Create a login</h2>
          <label htmlFor="team-name">Name</label>
          <input
            id="team-name"
            required
            minLength={2}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <label htmlFor="team-email">Email</label>
          <input
            id="team-email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <label htmlFor="team-role">Workspace</label>
          <select
            id="team-role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="receptionist">Receptionist — appointments and front desk</option>
            <option value="doctor">Doctor — consultations and patient care</option>
            <option value="admin">Admin — clinic setup and connections</option>
          </select>
          {form.role === 'doctor' && (
            <>
              <label htmlFor="team-doctor">Doctor profile</label>
              <select
                id="team-doctor"
                required
                value={form.doctorId}
                onChange={(e) => setForm({ ...form, doctorId: e.target.value })}
              >
                <option value="">Choose a doctor</option>
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
          <label htmlFor="team-password">Password (at least 10 characters)</label>
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
            <button disabled={busy}>Create login</button>
          </p>
        </form>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await staff('/staff/doctors', doctor);
              setDoctor({ name: '', speciality: '' });
            }, 'Doctor added. Create their login using the form alongside.');
          }}
        >
          <h2>Add a doctor profile</h2>
          <p>Add the doctor here, then create their login.</p>
          <label htmlFor="doctor-name">Doctor’s name</label>
          <input
            id="doctor-name"
            required
            minLength={2}
            value={doctor.name}
            onChange={(e) => setDoctor({ ...doctor, name: e.target.value })}
          />
          <label htmlFor="speciality">Speciality</label>
          <input
            id="speciality"
            value={doctor.speciality}
            onChange={(e) => setDoctor({ ...doctor, speciality: e.target.value })}
          />
          <p>
            <button disabled={busy}>Add doctor</button>
          </p>
          <h3>Clinic doctors</h3>
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
