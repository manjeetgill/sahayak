'use client';
import Link from 'next/link';
import { useStaffLang } from '../lib/staffText';

export default function Home() {
  const { lang, setLang, x } = useStaffLang();
  const slug = 'dr-sharma';
  return (
    <div className="wrap home-page">
      <button className="ghost" type="button" onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}>{lang === 'hi' ? 'English' : 'हिन्दी'}</button>
      <section className="home-hero">
        <span className="page-eyebrow">{x('Clinic care, made simpler')}</span>
        <h1>Sahayak · सहायक</h1>
        <p>{x('Your clinic’s calm digital workspace.')}</p>
      </section>
      <p className="muted">{x("Example clinic: Dr. Sharma's Clinic.")}</p>
      <div className="card list home-links">
        <div>
          <Link href={`/c/${slug}`}>{x('Public clinic page')}</Link>
        </div>
        <div>
          <Link href={`/c/${slug}/checkin`}>{x('Patient check-in')}</Link>
        </div>
        <div>
          <Link href={`/c/${slug}/tv`}>{x('Waiting-room TV')}</Link>
        </div>
        <div>
          <Link href={`/c/${slug}/sim`}>{x('Try a WhatsApp conversation')}</Link>
        </div>
        <div>
          <Link href="/login">{x('Doctor and reception sign-in')}</Link>
        </div>
        <div>
          <Link href="/admin">{x('Admin sign-in')}</Link>
          <p className="muted">{x('Set up your clinic, payments, team, and assistant access.')}</p>
          <Link href="/admin/qr-checkin#online-payments">{x('Payment setup →')}</Link>
        </div>
      </div>
    </div>
  );
}
