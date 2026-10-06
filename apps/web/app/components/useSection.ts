'use client';
import { useEffect, useState } from 'react';
export function useSection(resolve: (hash: string) => string, fallback: string) {
  const [section, setSection] = useState(fallback);
  useEffect(() => {
    const sync = () => setSection(resolve(window.location.hash.slice(1)));
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [resolve]);
  return section;
}
