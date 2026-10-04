'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

/** Public page: confirms a certificate or prescription is genuine. Shows who issued it and when, never medical details. */
export default function Verify({ params }: { params: { code: string } }) {
  const [r, setR] = useState<any>(null);
  useEffect(() => {
    api(`/public/verify/${params.code}`)
      .then(setR)
      .catch(() => setR({ valid: false }));
  }, [params.code]);
  if (!r) return <div className="wrap">Checking…</div>;
  return (
    <div className="wrap">
      <h1>Document verification</h1>
      {r.valid ? (
        <div className="card" role="status" data-testid="verify-ok">
          <h2 style={{ color: 'var(--ok)' }}>✓ This document is genuine</h2>
          <p>
            {r.kind === 'prescription' ? 'Prescription' : 'Medical certificate'} <b>{r.number}</b>
          </p>
          <p>
            Issued on {new Date(r.issuedOn).toLocaleDateString('en-IN', { dateStyle: 'long' })} by{' '}
            <b>{r.doctor}</b> (Reg. No. {r.registrationNo}), {r.clinic}
          </p>
          <p className="muted">For patient: {r.patientInitials}</p>
          <p className="muted">
            Compare the document number and patient initials with the paper or PDF you were given.
            Medical details are not shown here.
          </p>
        </div>
      ) : r.status === 'void' ? (
        <div className="card" role="alert" data-testid="verify-void">
          <h2 style={{ color: 'var(--danger)' }}>This document was withdrawn</h2>
          <p>{r.number} was cancelled by the issuing doctor and is no longer valid.</p>
        </div>
      ) : (
        <div className="card" role="alert" data-testid="verify-bad">
          <h2 style={{ color: 'var(--danger)' }}>Not found</h2>
          <p>No document matches this code. It may be forged or mistyped.</p>
        </div>
      )}
    </div>
  );
}
