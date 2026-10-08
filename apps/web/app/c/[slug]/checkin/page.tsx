'use client';
import { useEffect, useState } from 'react';
import { t, type Lang } from '@sahayak/shared';
import { api } from '../../../../lib/api';

type Info = {
  clinic: string;
  defaultLanguage: Lang;
  doctors: { id: string; name: string; speciality: string }[];
};

export default function CheckIn({ params }: { params: { slug: string } }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [lang, setLang] = useState<Lang>('en');
  const [phone, setPhone] = useState(''),
    [name, setName] = useState(''),
    [doctorId, setDoctorId] = useState('');
  const [returning, setReturning] = useState<boolean | null>(null);
  const [visit, setVisit] = useState(false),
    [wa, setWa] = useState(false),
    [rem, setRem] = useState(false);
  const [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    token: number;
    waitMinutes: number;
    name?: string;
    returning: boolean;
  } | null>(null);

  useEffect(() => {
    api<Info>(`/public/${params.slug}`)
      .then((i) => {
        setInfo(i);
        setLang(i.defaultLanguage);
        setDoctorId(i.doctors[0]?.id ?? '');
      })
      .catch((e) => setErr(e.message));
  }, [params.slug]);

  const lookup = async () => {
    setErr('');
    if (!/^\+?\d{10,13}$/.test(phone.replace(/[\s-]/g, '')))
      return setErr(lang === 'hi' ? 'सही मोबाइल नंबर लिखें' : 'Enter a valid mobile number');
    try {
      setReturning(
        (
          await api(`/public/${params.slug}/lookup`, {
            body: { phone: phone.replace(/[\s-]/g, '') },
          })
        ).returning,
      );
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!returning && !visit) return setErr(t(lang, 'checkin.consent_required'));
    setBusy(true);
    try {
      const r = await api(`/public/${params.slug}/checkin`, {
        body: {
          name: returning ? undefined : name,
          phone: phone.replace(/[\s-]/g, ''),
          doctorId,
          language: lang,
          consent: { visit_data: visit, whatsapp_messaging: wa, reminders_followups: rem },
        },
      });
      setDone(r);
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  if (!info) return <div className="wrap">{err ? <div className="error">{err}</div> : '…'}</div>;
  return (
    <div className="wrap checkin-page">
      <div className="row between">
        <h1>{t(lang, 'checkin.title', { clinic: info.clinic })}</h1>
        <button className="ghost small" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>
          {t(lang, 'checkin.language')}
        </button>
      </div>
      <div className="checkin-progress" aria-label="Check-in progress">
        <span className="active">1</span>
        <i />
        <span className={returning !== null || done ? 'active' : ''}>2</span>
        <i />
        <span className={done ? 'active' : ''}>3</span>
        <i />
        <span className={done ? 'active' : ''}>4</span>
      </div>
      {done ? (
        <div className="card" role="status">
          {done.returning && done.name && (
            <p>{t(lang, 'checkin.welcome_back', { name: done.name })}</p>
          )}
          <div className="token" data-testid="token">
            {done.token}
          </div>
          <p style={{ textAlign: 'center' }}>
            {t(lang, 'checkin.token_issued', { token: done.token, wait: done.waitMinutes })}
          </p>
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
          <label htmlFor="phone">{t(lang, 'checkin.phone')}</label>
          <input
            id="phone"
            inputMode="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setReturning(null);
            }}
            onBlur={() => phone && returning === null && lookup()}
            placeholder="98XXXXXXXX"
          />
          {returning === null && (
            <p>
              <button type="button" onClick={lookup}>
                {t(lang, 'checkin.continue')} →
              </button>
            </p>
          )}
          {returning !== null && (
            <>
              {!returning && (
                <>
                  <label htmlFor="name">{t(lang, 'checkin.name')}</label>
                  <input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </>
              )}
              <label htmlFor="doc">{t(lang, 'checkin.doctor')}</label>
              <select id="doc" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                {info.doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.speciality}
                  </option>
                ))}
              </select>
              {!returning && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={visit}
                    onChange={(e) => setVisit(e.target.checked)}
                  />
                  {t(lang, 'checkin.consent.visit')}
                </label>
              )}
              <label className="check">
                <input type="checkbox" checked={wa} onChange={(e) => setWa(e.target.checked)} />
                {t(lang, 'checkin.consent.whatsapp')}
              </label>
              <label className="check">
                <input type="checkbox" checked={rem} onChange={(e) => setRem(e.target.checked)} />
                {t(lang, 'checkin.consent.reminders')}
              </label>
              <p>
                <button type="submit" disabled={busy}>
                  {t(lang, 'checkin.submit')}
                </button>
              </p>
            </>
          )}
          {err && (
            <div className="error" role="alert">
              {err}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
