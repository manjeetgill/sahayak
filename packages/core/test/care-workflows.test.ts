import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, makePool, withClinic } from '@sahayak/db';
import { callTool, EventBus, registerAllTools, type ToolContext } from '../src';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
const rt = {
  pool,
  bus: new EventBus(''),
  channel: { name: 'test-provider', queued: true, send: async () => {} },
};
let a: Awaited<ReturnType<typeof createTestClinic>>, b: typeof a;
let ctx: ToolContext, patient: string, other: string, waiting: string, noConsent: string;
const run = (tool: string, input: unknown, context = ctx) => callTool(rt, context, tool, input);
beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  a = await createTestClinic(admin, 'care');
  b = await createTestClinic(admin, 'other-care');
  await admin.query(
    "UPDATE clinics SET timezone=(SELECT name FROM pg_timezone_names WHERE to_char(now() AT TIME ZONE name,'HH24')='12' LIMIT 1) WHERE id=$1",
    [a.clinicId],
  );
  const user = (
    await admin.query(
      "INSERT INTO staff_users(clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,'unused','Care doctor','doctor',$3) RETURNING id",
      [a.clinicId, `${a.slug}@test.invalid`, a.doctorIds[0]],
    )
  ).rows[0].id;
  ctx = {
    clinicId: a.clinicId,
    actor: { kind: 'staff', role: 'doctor', userId: user, doctorId: a.doctorIds[0] },
  };
  patient = await addPatient(admin, a.clinicId, 'Original patient', '+919400011111');
  waiting = await addPatient(admin, a.clinicId, 'Waiting patient', '+919400011112');
  noConsent = await addPatient(admin, a.clinicId, 'No consent', '+919400011113', {
    whatsapp: false,
  });
  other = await addPatient(admin, b.clinicId, 'Other patient', '+919400011114');
});
afterAll(async () => {
  if (a) await dropTestClinic(admin, a.clinicId);
  if (b) await dropTestClinic(admin, b.clinicId);
  await admin.end();
  await pool.end();
});

describe('clinical workflow boundaries', () => {
  it('links note drafts to the correct visit and reports completion gaps', async () => {
    const visit = (
      await admin.query(
        "INSERT INTO queue_entries(clinic_id,patient_id,doctor_id,queue_date,token_number,position_key,status) VALUES ($1,$2,$3,current_date,9001,9001,'in_consultation') RETURNING id",
        [a.clinicId, patient, a.doctorIds[0]],
      )
    ).rows[0].id;
    await expect(
      run('save_visit_note_draft', {
        patientId: waiting,
        queueEntryId: visit,
        transcript: 'History: example',
        note: { history: 'example' },
      }),
    ).rejects.toThrow('Visit must belong');
    const draft = await run('save_visit_note_draft', {
      patientId: patient,
      queueEntryId: visit,
      transcript: 'History: example',
      note: { history: 'example' },
    });
    let checklist = await run('get_visit_checklist', { queueEntryId: visit });
    expect(checklist.signedNote).toBe(false);
    expect(checklist.notes[0].status).toBe('draft');
    await run('sign_visit_note', { noteId: draft.noteId });
    checklist = await run('get_visit_checklist', { queueEntryId: visit });
    expect(checklist.signedNote).toBe(true);
  });
  it('shows attributed sources without writing clinical content to audit', async () => {
    const note = await run('save_visit_note_draft', {
      patientId: patient,
      transcript: 'History: private symptom',
      note: { history: 'private symptom' },
    });
    await run('sign_visit_note', { noteId: note.noteId });
    const brief = await run('get_previsit_brief', { patientId: patient });
    expect(brief.notes[0].id).toBe(note.noteId);
    expect(brief.notes[0].note.history).toBe('private symptom');
    const audit = (
      await admin.query(
        "SELECT input,output FROM agent_actions WHERE clinic_id=$1 AND tool='get_previsit_brief'",
        [a.clinicId],
      )
    ).rows;
    expect(JSON.stringify(audit)).not.toContain('private symptom');
    await expect(run('get_previsit_brief', { patientId: other })).rejects.toThrow(
      'Patient not found',
    );
    await expect(
      run(
        'get_previsit_brief',
        { patientId: patient },
        {
          ...ctx,
          actor: { kind: 'staff', role: 'receptionist', userId: (ctx.actor as any).userId },
        },
      ),
    ).rejects.toThrow();
  });
  it('requires source report, ordered review, and matching patient ownership', async () => {
    const task = await run('create_care_task', {
      patientId: patient,
      kind: 'report',
      title: 'Requested report',
      assignedTo: (ctx.actor as any).userId,
      dueAt: new Date(Date.now() - 60000).toISOString(),
    });
    expect((await run('list_care_tasks', { patientId: patient })).tasks[0].overdue).toBe(true);
    await expect(
      run('update_care_task', { taskId: task.taskId, status: 'reviewed' }),
    ).rejects.toThrow('in order');
    await expect(
      run('update_care_task', { taskId: task.taskId, status: 'received' }),
    ).rejects.toThrow('Attach');
    const doc = await run('store_patient_document', {
      patientId: waiting,
      filename: 'test.pdf',
      base64: Buffer.from('%PDF-1.4 test').toString('base64'),
    });
    await expect(
      run('update_care_task', {
        taskId: task.taskId,
        status: 'received',
        documentId: doc.documentId,
      }),
    ).rejects.toThrow('does not belong');
    const own = await run('store_patient_document', {
      patientId: patient,
      filename: 'test.pdf',
      base64: Buffer.from('%PDF-1.4 test').toString('base64'),
    });
    for (const status of ['received', 'reviewed', 'informed'])
      await run('update_care_task', {
        taskId: task.taskId,
        status,
        ...(status === 'received' ? { documentId: own.documentId } : {}),
      });
    const saved = (await run('list_care_tasks', { patientId: patient })).tasks[0];
    expect(saved.reviewed_by).toBe((ctx.actor as any).userId);
    expect(saved.informed_at).toBeTruthy();
    expect(saved.overdue).toBe(false);
  });
  it('keeps new tenant tables isolated', async () => {
    for (const table of ['care_tasks', 'appointment_waitlist', 'slot_offers']) {
      const rows = await withClinic(pool, b.clinicId, (db) => db.query(`SELECT id FROM ${table}`));
      expect(rows.rowCount).toBe(0);
    }
  });
});

async function makeOffer(date: string) {
  await run('join_waitlist', {
    patientId: waiting,
    doctorId: a.doctorIds[0],
    fromDate: date,
    toDate: date,
    optedIn: true,
  });
  const slots = await run('list_free_slots', { doctorId: a.doctorIds[0], date, count: 3 });
  const booked = await run('book_appointment', {
    patientId: patient,
    doctorId: a.doctorIds[0],
    startsAt: slots.slots[0],
  });
  await run('cancel_appointment', { appointmentId: booked.appointmentId });
  const offer = (
    await admin.query(
      "SELECT * FROM slot_offers WHERE clinic_id=$1 AND starts_at=$2 AND status='pending'",
      [a.clinicId, slots.slots[0]],
    )
  ).rows[0];
  expect(offer).toBeTruthy();
  return offer;
}
describe('cancellation offers', () => {
  it('requires both consent and explicit opt-in', async () => {
    await expect(
      run('join_waitlist', {
        patientId: noConsent,
        doctorId: a.doctorIds[0],
        fromDate: '2099-01-01',
        toDate: '2099-01-02',
        optedIn: true,
      }),
    ).rejects.toThrow('consent');
    await expect(
      run('join_waitlist', {
        patientId: waiting,
        doctorId: a.doctorIds[0],
        fromDate: '2099-01-01',
        toDate: '2099-01-02',
        optedIn: false,
      }),
    ).rejects.toThrow();
  });
  it('reserves the slot and concurrent acceptance books it only once', async () => {
    const offer = await makeOffer('2099-01-01');
    await expect(
      run('book_appointment', {
        patientId: patient,
        doctorId: a.doctorIds[0],
        startsAt: offer.starts_at.toISOString(),
      }),
    ).rejects.toThrow('not available');
    const actor: ToolContext = {
      clinicId: a.clinicId,
      patientId: waiting,
      actor: { kind: 'agent', agent: 'front_desk' },
    };
    const results = await Promise.all([
      run('accept_slot_offer', { code: offer.code }, actor),
      run('accept_slot_offer', { code: offer.code }, actor),
    ]);
    expect(results.filter((r) => r.accepted)).toHaveLength(1);
    const count = (
      await admin.query(
        "SELECT count(*) FROM appointments WHERE clinic_id=$1 AND starts_at=$2 AND status='booked'",
        [a.clinicId, offer.starts_at],
      )
    ).rows[0].count;
    expect(Number(count)).toBe(1);
  });
  it('rejects expired offers and frees the reservation', async () => {
    const offer = await makeOffer('2099-01-02');
    await admin.query("UPDATE slot_offers SET expires_at=now()-interval '1 minute' WHERE id=$1", [
      offer.id,
    ]);
    expect(
      (
        await run(
          'accept_slot_offer',
          { code: offer.code },
          {
            clinicId: a.clinicId,
            patientId: waiting,
            actor: { kind: 'agent', agent: 'front_desk' },
          },
        )
      ).accepted,
    ).toBe(false);
    await expect(
      run('book_appointment', {
        patientId: patient,
        doctorId: a.doctorIds[0],
        startsAt: offer.starts_at.toISOString(),
      }),
    ).resolves.toHaveProperty('appointmentId');
  });
  it('does not allow another patient to accept an offer', async () => {
    const offer = await makeOffer('2099-01-03');
    expect(
      (
        await run(
          'accept_slot_offer',
          { code: offer.code },
          {
            clinicId: a.clinicId,
            patientId: patient,
            actor: { kind: 'agent', agent: 'front_desk' },
          },
        )
      ).accepted,
    ).toBe(false);
  });
});
