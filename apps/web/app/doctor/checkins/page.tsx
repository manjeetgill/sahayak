'use client';
import { useEffect, useState } from 'react';
import { useSession } from '../../../lib/api';
import { FeedbackPreferences } from '../../components/FeedbackPreferences';
import { CareNav } from '../../components/CareNav';
import { FeedbackWorkspace } from '../../components/FeedbackWorkspace';
import { FeedbackReport } from '../../components/FeedbackReport';
export default function Checkins() {
  const s = useSession('doctor');
  const [tab, setTab] = useState('patients');
  useEffect(() => {
    const open = () => {
      if (location.hash.startsWith('#case-')) setTab('patients');
      else if (location.hash === '#settings') setTab('settings');
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
  if (!s) return null;
  return (
    <div className="wrap">
      <p className="eyebrow">AFTER THE VISIT</p>
      <h1>Check on my patients</h1>
      <p>Hear concerns early. Follow through personally. Improve the clinic experience.</p>
      <CareNav />
      <nav className="section-tabs" aria-label="Patient check-in views">
        {[
          ['patients', 'Patient responses'],
          ['improve', 'Clinic improvements'],
          ['settings', 'Automatic check-ins'],
        ].map(([v, l]) => (
          <button key={v} className={tab === v ? '' : 'ghost'} onClick={() => setTab(v)}>
            {l}
          </button>
        ))}
      </nav>
      {tab === 'patients' ? (
        <FeedbackWorkspace />
      ) : tab === 'settings' ? (
        <FeedbackPreferences />
      ) : (
        <FeedbackReport />
      )}
    </div>
  );
}
