import { z } from 'zod';
import { defineTool, ToolError } from './registry';

const DOCTOR = ['staff:doctor'];
const UUID = z.string().uuid();
const doctorId = (actor: any): string => {
  if (actor.kind !== 'staff' || actor.role !== 'doctor' || !actor.doctorId)
    throw new ToolError('forbidden', 'Only a doctor can use this', 403);
  return actor.doctorId;
};

/** Common generic-name examples for lookup only; no indications, doses or stock claims. */
export const STARTER_MEDICINE_NAMES = [
  'Albendazole',
  'Amlodipine',
  'Amoxicillin',
  'Atorvastatin',
  'Azithromycin',
  'Cetirizine',
  'Ciprofloxacin',
  'Doxycycline',
  'Enalapril',
  'Folic acid',
  'Ibuprofen',
  'Insulin regular',
  'Iron and folic acid',
  'Losartan',
  'Metformin',
  'Metronidazole',
  'Omeprazole',
  'Oral rehydration salts',
  'Paracetamol',
  'Salbutamol',
  'Sodium chloride',
  'Vitamin D3',
];

export const listMedicineCatalog = defineTool({
  name: 'list_medicine_catalog',
  description: 'List generic ingredient names and this doctor’s own added medicine names.',
  module: 'core',
  scope: 'read',
  input: z.object({}),
  allow: DOCTOR,
  auditInput: () => ({}),
  async run({ db, ctx }) {
    const custom = (
      await db.query(
        'SELECT id, name FROM doctor_medicine_catalog WHERE doctor_id=$1 ORDER BY lower(name)',
        [doctorId(ctx.actor)],
      )
    ).rows as { id: string; name: string }[];
    return { starter: STARTER_MEDICINE_NAMES, custom };
  },
});

export const addMedicineName = defineTool({
  name: 'add_medicine_name',
  description: 'Add a medicine name to this doctor’s personal lookup list.',
  module: 'core',
  input: z.object({ name: z.string().trim().min(2).max(100) }),
  allow: DOCTOR,
  auditInput: () => ({ medicineNameSaved: true }),
  async run({ db, ctx }, { name }) {
    const mine = doctorId(ctx.actor);
    const count = (
      await db.query('SELECT count(*)::int AS n FROM doctor_medicine_catalog WHERE doctor_id=$1', [
        mine,
      ])
    ).rows[0].n as number;
    if (count >= 200)
      throw new ToolError('too_many', 'Remove a medicine name before adding another');
    const existing = await db.query(
      'SELECT id FROM doctor_medicine_catalog WHERE doctor_id=$1 AND lower(name)=lower($2)',
      [mine, name],
    );
    if (existing.rowCount) return { id: existing.rows[0].id as string };
    const row = await db.query(
      'INSERT INTO doctor_medicine_catalog (clinic_id,doctor_id,name) VALUES ($1,$2,$3) RETURNING id',
      [ctx.clinicId, mine, name],
    );
    return { id: row.rows[0].id as string };
  },
});

export const removeMedicineName = defineTool({
  name: 'remove_medicine_name',
  description: 'Remove a name from this doctor’s personal medicine lookup list.',
  module: 'core',
  input: z.object({ id: UUID }),
  allow: DOCTOR,
  auditInput: (i) => ({ id: i.id }),
  async run({ db, ctx }, { id }) {
    const row = await db.query(
      'DELETE FROM doctor_medicine_catalog WHERE id=$1 AND doctor_id=$2 RETURNING id',
      [id, doctorId(ctx.actor)],
    );
    if (!row.rowCount) throw new ToolError('not_found', 'Medicine name not found', 404);
    return { ok: true };
  },
});

export const startConversationCapture = defineTool({
  name: 'start_conversation_capture',
  description: 'Record that the patient agreed to browser speech capture before it starts.',
  module: 'core',
  input: z.object({ patientId: UUID }),
  allow: DOCTOR,
  auditInput: (i) => ({ patientId: i.patientId, consentRecorded: true }),
  async run({ db, ctx }, { patientId }) {
    const mine = doctorId(ctx.actor);
    if (!(await db.query('SELECT 1 FROM patients WHERE id=$1', [patientId])).rowCount)
      throw new ToolError('not_found', 'Patient not found', 404);
    const row = await db.query(
      `INSERT INTO consultation_capture_consents
       (clinic_id,patient_id,doctor_id,recorded_by) VALUES ($1,$2,$3,$4) RETURNING id,agreed_at`,
      [ctx.clinicId, patientId, mine, ctx.actor.kind === 'staff' ? ctx.actor.userId : null],
    );
    return { consentId: row.rows[0].id as string, agreedAt: row.rows[0].agreed_at as Date };
  },
});

export const stopConversationCapture = defineTool({
  name: 'stop_conversation_capture',
  description: 'Record the end of a consented browser speech capture.',
  module: 'core',
  input: z.object({ consentId: UUID }),
  allow: DOCTOR,
  auditInput: (i) => ({ consentId: i.consentId }),
  async run({ db, ctx }, { consentId }) {
    const row = await db.query(
      `UPDATE consultation_capture_consents SET ended_at=COALESCE(ended_at,now())
       WHERE id=$1 AND doctor_id=$2 RETURNING ended_at`,
      [consentId, doctorId(ctx.actor)],
    );
    if (!row.rowCount) throw new ToolError('not_found', 'Capture not found', 404);
    return { stopped: true };
  },
});

export const consultationAidTools = [
  listMedicineCatalog,
  addMedicineName,
  removeMedicineName,
  startConversationCapture,
  stopConversationCapture,
];
