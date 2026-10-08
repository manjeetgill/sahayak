import { z } from 'zod';
import { defineTool } from './registry';

export const patientSources = defineTool({
  name: 'patient_sources',
  description: 'How many new patients came from each link in the last 90 days.',
  module: 'core',
  scope: 'read',
  input: z.object({}),
  allow: ['staff:doctor', 'staff:receptionist'],
  auditInput: () => ({}),
  async run({ db }) {
    const rows = (
      await db.query(
        `SELECT coalesce(source,'other') AS source, count(*)::int AS patients
           FROM patients WHERE created_at > now() - interval '90 days' AND imported_at IS NULL
          GROUP BY 1 ORDER BY 2 DESC`,
      )
    ).rows as { source: string; patients: number }[];
    return { days: 90, sources: rows };
  },
});

export const growthTools = [patientSources];
