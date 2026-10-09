'use client';
import { useEffect, useState } from 'react';
import { useSession } from '../../../lib/api';
import { AdminFeedbackOverview } from '../../components/AdminFeedbackOverview';
import { FeedbackPreferences } from '../../components/FeedbackPreferences';
import { CareNav } from '../../components/CareNav';
import { FeedbackWorkspace } from '../../components/FeedbackWorkspace';
import { FeedbackReport } from '../../components/FeedbackReport';
import { EveningUpdates } from '../../components/EveningUpdates';
import { useStaffLang } from '../../../lib/staffText';
export default function Checkins() {
  const { x } = useStaffLang();
  const s = useSession('doctor');
  const [tab, setTab] = useState('patients');
  const admin = s?.user.role === 'admin';
  useEffect(() => {
    const open = () => {
      if (location.hash.startsWith('#case-')) setTab('patients');
      else if (['#patients', '#improve', '#settings'].includes(location.hash))
        setTab(location.hash.slice(1));
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
  if (!s) return null;
  return (
    <div className="wrap">
      <p className="eyebrow">{x('AFTER THE VISIT')}</p>
      <h1>{x('Patient feedback')}</h1>
      <p>{x('Hear concerns early. Follow through personally. Improve the clinic experience.')}</p>
      <CareNav />
      <nav className="section-tabs" aria-label={x('Patient check-in views')}>
        {[
          ['patients', 'Patient responses'],
          ['improve', 'Clinic improvements'],
          ['settings', 'Automatic check-ins'],
        ].map(([v, l]) => (
          <button
            key={v}
            className={tab === v ? '' : 'ghost'}
            onClick={() => {
              setTab(v);
              location.hash = v;
            }}
          >
            {x(l)}
          </button>
        ))}
      </nav>
      {tab === 'patients' ? (
        <>
          <FeedbackWorkspace />
          <EveningUpdates />
        </>
      ) : tab === 'settings' ? (
        admin ? (
          <AdminFeedbackOverview />
        ) : (
          <FeedbackPreferences />
        )
      ) : (
        <FeedbackReport />
      )}
    </div>
  );
}
