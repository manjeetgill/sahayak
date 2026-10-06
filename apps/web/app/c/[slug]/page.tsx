'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

const DAYS: [string, string][] = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
];
const digits = (n?: string | null) => (n ?? '').replace(/\D/g, '');

/** Public clinic page: who we are, when we are open, how to book. Shows only what the clinic chose to publish. */
export default function ClinicPage({ params }: { params: { slug: string } }) {
  const [c, setC] = useState<any>(null),
    [err, setErr] = useState('');
  useEffect(() => {
    api(`/public/${params.slug}/profile`)
      .then(setC)
      .catch((e) => setErr(e.message));
  }, [params.slug]);
  if (err)
    return (
      <div className="wrap">
        <h1>Clinic not found</h1>
      </div>
    );
  if (!c) return <div className="wrap">…</div>;
  const wa = digits(c.doctors.length === 1 ? c.doctors[0].whatsapp : null) || digits(c.whatsapp);
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'MedicalClinic',
    name: c.name,
    address: c.address ?? undefined,
    telephone: c.phone ?? undefined,
    url: `${origin}/c/${c.slug}`,
    ...(c.rating
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: c.rating.average,
            reviewCount: c.rating.count,
            bestRating: 5,
          },
        }
      : {}),
  };
  return (
    <div className="wrap public-clinic-page" style={{ maxWidth: 900 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <section className="public-clinic-hero">
        <h1>{c.name}</h1>
        {c.rating && (
          <p data-testid="rating">
            ★ {c.rating.average}{' '}
            <span className="muted">
              from {c.rating.count} patient ratings collected after visits
            </span>
          </p>
        )}
        {c.about && <p>{c.about}</p>}
      </section>
      <div className="card" style={{ margin: '1rem 0' }}>
        <h2>Book an appointment</h2>
        <p className="row" style={{ flexWrap: 'wrap' }}>
          {wa && (
            <a href={`https://wa.me/${wa}?text=${encodeURIComponent('I need an appointment')}`}>
              <button type="button">Book on WhatsApp</button>
            </a>
          )}
          <a href={`/c/${c.slug}/checkin`}>
            <button type="button" className="ghost">
              Visiting today? Check in
            </button>
          </a>
          {c.phone && (
            <a href={`tel:${c.phone}`}>
              <button type="button" className="ghost">
                Call {c.phone}
              </button>
            </a>
          )}
        </p>
      </div>
      <div className="card">
        <h2>Doctors</h2>
        <div className="list">
          {c.doctors.map((d: any) => (
            <div key={d.id}>
              <b>{d.name}</b>{' '}
              <span className="muted">
                {[d.speciality, d.qualifications].filter(Boolean).join(' · ')}
                {d.registrationNo ? ` · Reg. No. ${d.registrationNo}` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{ marginTop: '1rem' }}>
        <h2>Opening hours</h2>
        <div className="list">
          {DAYS.map(([k, label]) => (
            <div key={k} className="row between">
              <span>{label}</span>
              <span className="muted">{c.timings?.[k] || 'Closed'}</span>
            </div>
          ))}
        </div>
      </div>
      {c.address && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h2>Find us</h2>
          <p>{c.address}</p>
          {c.directions && <p className="muted">{c.directions}</p>}
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.name} ${c.address}`)}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Maps
          </a>
        </div>
      )}
    </div>
  );
}
