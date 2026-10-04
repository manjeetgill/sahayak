import Link from 'next/link';

export default function Home() {
  const slug = 'dr-sharma';
  return (
    <div className="wrap">
      <h1>Sahayak · सहायक</h1>
      <p className="muted">AI front desk for clinics. Demo clinic: Dr. Sharma&apos;s Clinic.</p>
      <div className="card list">
        <div>
          <Link href={`/c/${slug}/checkin`}>Patient check-in (QR page)</Link>
        </div>
        <div>
          <Link href={`/c/${slug}/tv`}>Waiting-room TV</Link>
        </div>
        <div>
          <Link href={`/c/${slug}/sim`}>WhatsApp simulator</Link>
        </div>
        <div>
          <Link href="/login">Staff sign-in (doctor screen · receptionist console)</Link>
        </div>
      </div>
    </div>
  );
}
