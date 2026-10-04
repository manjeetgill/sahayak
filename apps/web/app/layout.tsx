import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Sahayak', description: 'AI front desk for clinics' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
