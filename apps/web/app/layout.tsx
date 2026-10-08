import type { Metadata } from 'next';
import './globals.css';
import { PwaSupport } from './components/PwaSupport';

export const metadata: Metadata = {
  title: 'Sahayak',
  description: 'AI front desk for clinics',
  appleWebApp: { capable: true, title: 'Sahayak' },
  icons: { apple: '/icon-192.png' },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PwaSupport />
        {children}
      </body>
    </html>
  );
}
