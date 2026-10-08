import { z } from 'zod';
import { PhoneSchema } from '@sahayak/shared';
import { defineTool, ToolError } from './registry';

// Reception only: admins are deliberately kept away from patient data in this product.
const STAFF = ['staff:receptionist'];
const MAX_ROWS = 2000;
const RowIn = z.object({
  name: z.string().max(200),
  phone: z.string().max(40),
  yearOfBirth: z.union([z.string(), z.number()]).optional(),
  age: z.union([z.string(), z.number()]).optional(),
  language: z.string().max(20).optional(),
});
const Input = z.object({ rows: z.array(RowIn).min(1).max(MAX_ROWS) });

type Clean = { name: string; phone: string; yearOfBirth: number | null; language: 'en' | 'hi' };
type Checked =
  | { line: number; status: 'new'; row: Clean }
  | { line: number; status: 'duplicate_existing' | 'duplicate_in_file'; row: Clean }
  | { line: number; status: 'invalid'; reason: string };

const LANG: Record<string, 'en' | 'hi'> = {
  en: 'en',
  english: 'en',
  hi: 'hi',
  hindi: 'hi',
  हिन्दी: 'hi',
  हिंदी: 'hi',
};

function clean(r: z.infer<typeof RowIn>): Clean | string {
  const name = r.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return 'Name is missing';
  const p = PhoneSchema.safeParse(r.phone.replace(/[\s()-]/g, ''));
  if (!p.success) return 'Phone number is not valid';
  const nowYear = new Date().getFullYear();
  let yob: number | null = null;
  const y = String(r.yearOfBirth ?? '').trim();
  const a = String(r.age ?? '').trim();
  if (y) {
    const n = Number(y);
    if (!Number.isInteger(n) || n < 1900 || n > nowYear) return 'Year of birth is not valid';
    yob = n;
  } else if (a) {
    const n = Number(a);
    if (!Number.isInteger(n) || n < 0 || n > 120) return 'Age is not valid';
    yob = nowYear - n;
  }
  const l = (r.language ?? '').trim().toLowerCase();
  if (l && !LANG[l]) return 'Language must be English or Hindi';
  return { name, phone: p.data, yearOfBirth: yob, language: LANG[l] ?? 'en' };
}

async function check(
  db: { query: (q: string, p?: unknown[]) => Promise<any> },
  rows: z.infer<typeof RowIn>[],
) {
  const existing = new Set<string>(
    (await db.query('SELECT phone FROM patients')).rows.map((r: any) => r.phone as string),
  );
  const seen = new Set<string>();
  const out: Checked[] = rows.map((raw, i) => {
    const c = clean(raw);
    if (typeof c === 'string') return { line: i + 1, status: 'invalid', reason: c };
    if (existing.has(c.phone)) return { line: i + 1, status: 'duplicate_existing', row: c };
    if (seen.has(c.phone)) return { line: i + 1, status: 'duplicate_in_file', row: c };
    seen.add(c.phone);
    return { line: i + 1, status: 'new', row: c };
  });
  return out;
}

const counts = (c: Checked[]) => ({
  total: c.length,
  new: c.filter((x) => x.status === 'new').length,
  duplicateExisting: c.filter((x) => x.status === 'duplicate_existing').length,
  duplicateInFile: c.filter((x) => x.status === 'duplicate_in_file').length,
  invalid: c.filter((x) => x.status === 'invalid').length,
});

// Patient names and numbers never go into the audit log: only counts.
export const previewPatientImport = defineTool({
  name: 'preview_patient_import',
  description: 'Check a patient list before importing it. Nothing is saved.',
  module: 'core',
  scope: 'read',
  input: Input,
  allow: STAFF,
  auditInput: (i) => ({ rows: i.rows.length }),
  auditOutput: (o: any) => o.counts,
  async run({ db }, i) {
    const c = await check(db, i.rows);
    return {
      counts: counts(c),
      // only the problems are returned for display; at most 100
      problems: c
        .filter((x) => x.status !== 'new')
        .slice(0, 100)
        .map((x) => ({
          line: x.line,
          status: x.status,
          reason: x.status === 'invalid' ? x.reason : undefined,
        })),
    };
  },
});

export const commitPatientImport = defineTool({
  name: 'commit_patient_import',
  description:
    'Import the new patients from a list. They get no consents and no messages: they give consent at their first check-in.',
  module: 'core',
  input: Input,
  allow: STAFF,
  auditInput: (i) => ({ rows: i.rows.length }),
  auditOutput: (o: any) => ({ imported: o.imported, batchId: o.batchId }),
  async run({ db, ctx }, i) {
    const c = await check(db, i.rows);
    const fresh = c.filter((x): x is Extract<Checked, { status: 'new' }> => x.status === 'new');
    if (!fresh.length)
      throw new ToolError('nothing_to_import', 'There are no new patients to import');
    const batchId = (await db.query('SELECT gen_random_uuid() id')).rows[0].id as string;
    for (const f of fresh) {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${ctx.clinicId}:patient:${f.row.phone}`,
      ]);
      await db.query(
        `INSERT INTO patients (clinic_id,name,phone,language,year_of_birth,imported_at,import_batch)
         VALUES ($1,$2,$3,$4,$5,now(),$6) ON CONFLICT (clinic_id, phone) DO NOTHING`,
        [ctx.clinicId, f.row.name, f.row.phone, f.row.language, f.row.yearOfBirth, batchId],
      );
    }
    return { batchId, imported: fresh.length, skipped: c.length - fresh.length };
  },
});

export const undoPatientImport = defineTool({
  name: 'undo_patient_import',
  description:
    'Remove the patients of one import that have not been used yet (no visits, bookings or messages).',
  module: 'core',
  input: z.object({ batchId: z.string().uuid() }),
  allow: STAFF,
  auditInput: (i) => ({ batchId: i.batchId }),
  async run({ db }, { batchId }) {
    const ids = (await db.query('SELECT id FROM patients WHERE import_batch=$1', [batchId])).rows;
    if (!ids.length) throw new ToolError('not_found', 'Import not found', 404);
    // Many tables cascade from patients, so a patient is removed only when NOTHING refers to them:
    // no consent, booking, visit, message or note. (Table names come from the catalog, never from input.)
    const tables = (
      await db.query(
        `SELECT table_name FROM information_schema.columns
          WHERE table_schema='public' AND column_name='patient_id' AND table_name <> 'patients'`,
      )
    ).rows.map((r: any) => r.table_name as string);
    let removed = 0;
    let kept = 0;
    for (const { id } of ids) {
      let used = false;
      for (const t of tables) {
        if (
          (
            await db.query(`SELECT 1 FROM "${t.replace(/"/g, '')}" WHERE patient_id=$1 LIMIT 1`, [
              id,
            ])
          ).rowCount
        ) {
          used = true;
          break;
        }
      }
      if (used) kept++;
      else {
        await db.query('DELETE FROM patients WHERE id=$1', [id]);
        removed++;
      }
    }
    return { removed, kept };
  },
});

export const patientImportTools = [previewPatientImport, commitPatientImport, undoPatientImport];
