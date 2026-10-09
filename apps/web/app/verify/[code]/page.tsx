'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useStaffLang } from '../../../lib/staffText';

/** Public page: confirms a certificate or prescription is genuine. Shows who issued it and when, never medical details. */
export default function Verify({ params }: { params: { code: string } }) {
  const { lang, setLang, x } = useStaffLang();
  const [r, setR] = useState<any>(null);
  useEffect(() => {
    api(`/public/verify/${params.code}`)
      .then(setR)
      .catch(() => setR({ valid: false }));
  }, [params.code]);
  if (!r) return <div className="wrap">{x('Checking…')}</div>;
  return (
    <div className="wrap">
      <button className="ghost" type="button" onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}>{lang === 'hi' ? 'English' : 'हिन्दी'}</button>
      <h1>{x('Document verification')}</h1>
      {r.valid ? (
        <div className="card" role="status" data-testid="verify-ok">
          <h2 style={{ color: 'var(--ok)' }}>{x('✓ This document is genuine')}</h2>
          <p>
            {x(r.kind === 'prescription' ? 'Prescription' : 'Medical certificate')} <b>{r.number}</b>
          </p>
          <p>
            {x('Issued on')} {new Date(r.issuedOn).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { dateStyle: 'long' })} {x('by')}{' '}
            <b>{r.doctor}</b> ({x('Reg. No.')} {r.registrationNo}), {r.clinic}
          </p>
          <p className="muted">{x('For patient:')} {r.patientInitials}</p>
          <p className="muted">
            {x('Compare the document number and patient initials with the paper or PDF you were given. Medical details are not shown here.')}
          </p>
        </div>
      ) : r.status === 'void' ? (
        <div className="card" role="alert" data-testid="verify-void">
          <h2 style={{ color: 'var(--danger)' }}>{x('This document was withdrawn')}</h2>
          <p>{r.number} {x('was cancelled by the issuing doctor and is no longer valid.')}</p>
        </div>
      ) : (
        <div className="card" role="alert" data-testid="verify-bad">
          <h2 style={{ color: 'var(--danger)' }}>{x('Not found')}</h2>
          <p>{x('No document matches this code. It may be forged or mistyped.')}</p>
        </div>
      )}
    </div>
  );
}
