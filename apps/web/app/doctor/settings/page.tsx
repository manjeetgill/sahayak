'use client';
import { useEffect, useState } from 'react';
import { staff, useSession } from '../../../lib/api';
import { useStaffLang } from '../../../lib/staffText';
export default function Profile() {
  const { x } = useStaffLang();
  const s = useSession('doctor');
  const [form, setForm] = useState({ registrationNo: '', qualifications: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  useEffect(() => {
    if (s)
      staff('/staff/settings')
        .then((c) => setPhone(c.myPhone || ''))
        .catch((e) => setError(e.message));
  }, [s]);
  useEffect(() => {
    if (s)
      staff('/staff/doctors/all')
        .then((rows: any[]) => {
          const me = rows.find((d) => d.id === s.user.doctorId);
          if (me)
            setForm({
              registrationNo: me.registration_no || '',
              qualifications: me.qualifications || '',
            });
        })
        .catch((e) => setError(e.message));
  }, [s]);
  if (!s) return null;
  if (s.user.role === 'admin')
    return (
      <div className="wrap">
        <h1>{x('Doctor professional details')}</h1>
        <p>
          {x('Review the clinic’s doctors from Doctors & team. Each doctor maintains their own registration and signing details.')}
        </p>
        <a href="/admin/team">{x('Open Doctors & team')}</a>
      </div>
    );
  return (
    <div className="wrap">
      <p className="eyebrow">{x('DOCTOR')}</p>
      <h1>{x('My professional details')}</h1>
      <p>
        <a href="/doctor/checkins#settings">{x('Automatic feedback after visits →')}</a>
      </p>
      <p>
        {x('Used on documents you review and sign. Your clinic admin manages clinic setup and connections.')}
      </p>
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setMessage('');
          try {
            await staff(`/staff/doctors/${s.user.doctorId}`, form, 'PATCH');
            setMessage(x('Your details are saved'));
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="registration">{x('Medical registration number')}</label>
        <input
          id="registration"
          required
          minLength={3}
          value={form.registrationNo}
          onChange={(e) => setForm({ ...form, registrationNo: e.target.value })}
        />
        <label htmlFor="qualifications">{x('Qualifications')}</label>
        <input
          id="qualifications"
          value={form.qualifications}
          onChange={(e) => setForm({ ...form, qualifications: e.target.value })}
        />
        <p>
          <button disabled={busy}>{x(busy ? 'Saving…' : 'Save my details')}</button>
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </form>
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setMessage('');
          try {
            await staff('/staff/phone', { phone }, 'PUT');
            setMessage(x('Your WhatsApp number is saved'));
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>{x('My WhatsApp updates')}</h2>
        <p>
          {x('Add your own number for clinic summaries and staff questions. Your admin controls the clinic’s delivery settings.')}
        </p>
        <label htmlFor="my-phone">{x('My WhatsApp number')}</label>
        <input
          id="my-phone"
          type="tel"
          placeholder="+919876543210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <p>
          <button disabled={busy}>{x('Save my number')}</button>
        </p>
      </form>
    </div>
  );
}
