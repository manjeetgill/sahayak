'use client';
import { useState } from 'react';
import { staff } from '../../lib/api';

/** Find a patient by name or phone and open their record. */
export function PatientSearch() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setRows(
      await staff(`/staff/patients/search?q=${encodeURIComponent(q.trim())}`).catch(() => []),
    );
  };
  return (
    <div className="card" data-testid="patient-search">
      <h3>Find a patient</h3>
      <form className="row" onSubmit={search}>
        <input
          aria-label="Find a patient"
          placeholder="Name or phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="ghost">
          Search
        </button>
      </form>
      {rows && (
        <div className="list">
          {rows.map((p) => (
            <div key={p.id}>
              <a href={`/doctor/patients/${p.id}`}>{p.name}</a>{' '}
              <span className="muted">
                {p.phone}
                {p.age ? ` · ${p.age}y` : ''}
                {p.tags?.length ? ` · ${p.tags.join(', ')}` : ''}
              </span>
            </div>
          ))}
          {!rows.length && <p className="muted">No match.</p>}
        </div>
      )}
    </div>
  );
}
