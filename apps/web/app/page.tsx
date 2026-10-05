import Link from 'next/link';

export default function Home() {
  const slug = 'dr-sharma';
  return (
    <div className="wrap">
      <h1>Sahayak · सहायक</h1>
      <p className="muted">Your clinic’s digital assistant. Example clinic: Dr. Sharma&apos;s Clinic.</p>
      <div className="card list">
        <div>
          <Link href={`/c/${slug}`}>Public clinic page</Link>
        </div>
        <div>
          <Link href={`/c/${slug}/checkin`}>Patient check-in</Link>
        </div>
        <div>
          <Link href={`/c/${slug}/tv`}>Waiting-room TV</Link>
        </div>
        <div>
          <Link href={`/c/${slug}/sim`}>Try a WhatsApp conversation</Link>
        </div>
        <div>
          <Link href="/login">Doctor and reception sign-in</Link>
        </div>
      </div>
    </div>
  );
}
