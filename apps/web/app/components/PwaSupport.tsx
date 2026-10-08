'use client';
import { useEffect, useState } from 'react';

/** Registers the offline page and tells staff when the connection is lost, so they do not type into the void. */
export function PwaSupport() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true),
      down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    if ('serviceWorker' in navigator && location.protocol === 'https:')
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  if (online) return null;
  return (
    <div className="banner warn offline-banner" role="status">
      You are offline. Changes will not be saved until the connection is back. · आप ऑफ़लाइन हैं।
    </div>
  );
}
