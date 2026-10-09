import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, makePool, withClinic } from '@sahayak/db';
import { EventBus, registerAllTools } from '@sahayak/core';
import { LlmGate, handleInbound } from '../src';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
const env = { rt: { pool, bus: new EventBus('') }, gate: new LlmGate(null) };
let c: Awaited<ReturnType<typeof createTestClinic>>;
beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  c = await createTestClinic(admin, 'conv');
  await addPatient(admin, c.clinicId, 'Known Pt', '+919300000001');
});
afterAll(async () => {
  await dropTestClinic(admin, c.clinicId);
  await admin.end();
  await pool.end();
});
const say = (from: string, text: string) =>
  handleInbound(env, { clinicId: c.clinicId, from, text });
const appts = () =>
  admin
    .query('SELECT status FROM appointments WHERE clinic_id=$1 ORDER BY created_at', [c.clinicId])
    .then((r) => r.rows.map((x) => x.status));

describe('WhatsApp front desk', () => {
  it('records an explicit evening opt-in, saves a check-in reply and allows evening-only opt-out', async () => {
    const phone = '+919300000044';
    const patientId = await addPatient(admin, c.clinicId, 'Evening Pt', phone);
    expect((await say(phone, 'EVENING YES')).replies.join(' ')).toContain('up to 3 evenings');
    expect(
      (
        await admin.query(
          "SELECT 1 FROM consents WHERE patient_id=$1 AND purpose='evening_checkins' AND withdrawn_at IS NULL",
          [patientId],
        )
      ).rowCount,
    ).toBe(1);
    const visit = (
      await admin.query(
        "INSERT INTO queue_entries(clinic_id,doctor_id,patient_id,queue_date,token_number,position_key,status) VALUES($1,$2,$3,current_date,440,440,'done') RETURNING id",
        [c.clinicId, c.doctorIds[0], patientId],
      )
    ).rows[0].id;
    const follow = (
      await admin.query(
        "INSERT INTO follow_ups(clinic_id,patient_id,queue_entry_id,kind,run_at,status,evening_number) VALUES($1,$2,$3,'post_visit',now(),'sent',1) RETURNING id",
        [c.clinicId, patientId, visit],
      )
    ).rows[0].id;
    await admin.query('UPDATE conversations SET state=$2 WHERE contact=$1', [
      phone,
      JSON.stringify({ flow: 'followup_checkin', followUpId: follow, eveningNumber: 1 }),
    ]);
    expect((await say(phone, 'About the same')).replies.join(' ')).toContain('Thank you');
    expect(
      (
        await admin.query('SELECT feeling FROM evening_checkin_replies WHERE follow_up_id=$1', [
          follow,
        ])
      ).rows[0].feeling,
    ).toBe('same');
    expect((await say(phone, 'EVENING STOP')).replies.join(' ')).toContain('stopped');
    expect(
      (
        await admin.query(
          "SELECT 1 FROM consents WHERE patient_id=$1 AND purpose='evening_checkins' AND withdrawn_at IS NULL",
          [patientId],
        )
      ).rowCount,
    ).toBe(0);
  });
  it('stops later evening prompts when a reply reports emergency symptoms', async () => {
    const phone = '+919300000045';
    const patientId = await addPatient(admin, c.clinicId, 'Urgent evening Pt', phone);
    const visit = (await admin.query(
      "INSERT INTO queue_entries(clinic_id,doctor_id,patient_id,queue_date,token_number,position_key,status) VALUES($1,$2,$3,current_date,445,445,'done') RETURNING id",
      [c.clinicId, c.doctorIds[0], patientId],
    )).rows[0].id;
    const first = (await admin.query(
      "INSERT INTO follow_ups(clinic_id,patient_id,queue_entry_id,kind,run_at,status,evening_number) VALUES($1,$2,$3,'post_visit',now(),'sent',1) RETURNING id",
      [c.clinicId, patientId, visit],
    )).rows[0].id;
    await admin.query(
      "INSERT INTO follow_ups(clinic_id,patient_id,queue_entry_id,kind,run_at,evening_number) VALUES($1,$2,$3,'post_visit',now()+interval '1 day',2)",
      [c.clinicId, patientId, visit],
    );
    await say(phone, 'hello');
    await admin.query('UPDATE conversations SET state=$2 WHERE contact=$1', [phone, JSON.stringify({ flow: 'followup_checkin', followUpId: first, eveningNumber: 1 })]);
    const urgent = await say(phone, 'chest pain and difficulty breathing');
    expect(urgent.redFlag).toBe(true);
    expect((await admin.query('SELECT feeling FROM evening_checkin_replies WHERE follow_up_id=$1', [first])).rows[0].feeling).toBe('worse');
    expect((await admin.query('SELECT status FROM follow_ups WHERE queue_entry_id=$1 AND evening_number=2', [visit])).rows[0].status).toBe('skipped');
  });
  it('answers a queue question during intake without saving it as an intake answer', async () => {
    const phone = '+919300000003';
    const patientId = await addPatient(admin, c.clinicId, 'Queue Pt', phone);
    await admin.query(
      `INSERT INTO queue_entries(clinic_id,doctor_id,patient_id,queue_date,token_number,position_key)
       VALUES($1,$2,$3,(now() AT TIME ZONE 'Asia/Kolkata')::date,7,7000)`,
      [c.clinicId, c.doctorIds[0], patientId],
    );
    await admin.query(
      'INSERT INTO conversations(clinic_id,patient_id,contact,state) VALUES($1,$2,$3,$4)',
      [c.clinicId, patientId, phone, JSON.stringify({ agent: 'intake', qi: 0, answers: [] })],
    );
    const status = await say(phone, 'What is my token number?');
    expect(status.replies[0]).toMatch(/token is 7/);
    const state = (await admin.query('SELECT state FROM conversations WHERE contact=$1', [phone]))
      .rows[0].state;
    expect(state).toMatchObject({ agent: 'intake', qi: 0, answers: [] });
    expect((await say(phone, 'Since yesterday')).replies[0]).toMatch(/Since when\?/);
  });
  it('answers timings and directions from clinic settings', async () => {
    expect((await say('+919300000001', 'what are your timings')).replies[0]).toMatch(
      /Mon-Sun 00:00-23:45/,
    );
    expect((await say('+919300000001', 'where are you located')).replies[0]).toMatch(
      /1 Test Road.*Next to the park/,
    );
  });
  it('books, moves and cancels an appointment through numbered choices', async () => {
    let r = await say('+919300000001', 'I want to book an appointment');
    expect(r.replies[0]).toMatch(/Which doctor/);
    r = await say('+919300000001', '1');
    expect(r.replies[0]).toMatch(/Which day and time suits you with Dr\. Test One/);
    r = await say('+919300000001', 'earliest');
    expect(r.replies[0]).toMatch(/Available slots with Dr\. Test One/);
    r = await say('+919300000001', '1');
    expect(r.replies[0]).toMatch(/is booked for/);
    expect(await appts()).toEqual(['booked']);
    r = await say('+919300000001', 'reschedule my appointment');
    expect(r.replies[0]).toMatch(/Which day and time suits you/);
    r = await say('+919300000001', 'tomorrow evening');
    expect(r.replies[0]).toMatch(/Pick a new time|Nothing is free/);
    r = await say('+919300000001', '2');
    expect(r.replies[0]).toMatch(/Done\. Your appointment is now/);
    r = await say('+919300000001', 'cancel my appointment');
    expect(r.replies[0]).toMatch(/is cancelled/);
    expect(await appts()).toEqual(['cancelled']);
  });
  it('replies in Hindi when the patient writes Hindi', async () => {
    const r = await say('+919300000002', 'क्लिनिक का समय क्या है?');
    expect(r.replies[0]).toMatch(/क्लिनिक का समय/);
  });
  it('does not invent answers outside clinic settings: hands to receptionist', async () => {
    const r = await say('+919300000001', 'do you accept the XYZ insurance card');
    expect(r.replies[0]).toMatch(/I don't have that information/);
    const f = await withClinic(
      pool,
      c.clinicId,
      async (db) => (await db.query("SELECT summary FROM flags WHERE kind='other'")).rows,
    );
    expect(f.length).toBeGreaterThan(0);
  });
  it('human takeover silences the agent until handed back', async () => {
    await say('+919300000001', 'I want to talk to a person');
    const r = await say('+919300000001', 'what are your timings');
    expect(r.replies).toEqual([]);
    expect(r.handledBy).toBe('human');
  });
});

describe('Leads agent: unknown number, consent first', () => {
  const lead = '+919300000099';
  it('welcomes, collects name, asks consent, then books', async () => {
    expect((await say(lead, 'hi')).replies[0]).toMatch(/Welcome to Clinic/);
    expect((await say(lead, 'I want an appointment')).replies[0]).toMatch(/first visit/);
    expect((await say(lead, '1')).replies[0]).toMatch(/your name/);
    expect((await say(lead, 'Lata Devi')).replies[0]).toMatch(/Reply YES/);
    expect((await admin.query('SELECT 1 FROM patients WHERE phone=$1', [lead])).rowCount).toBe(0); // nothing stored before consent
    const r = await say(lead, 'YES');
    expect(r.replies[0]).toMatch(/Which doctor/);
    const p = await admin.query(
      "SELECT p.name, (SELECT count(*) FROM consents WHERE patient_id=p.id AND purpose='visit_data') AS n FROM patients p WHERE phone=$1",
      [lead],
    );
    expect(p.rows[0]).toMatchObject({ name: 'Lata Devi', n: '1' });
  });
  it('declining consent stores nothing', async () => {
    const other = '+919300000098';
    await say(other, 'book');
    await say(other, 'Ravi K');
    await say(other, 'no');
    expect((await admin.query('SELECT 1 FROM patients WHERE phone=$1', [other])).rowCount).toBe(0);
  });
  it('never messages a lead proactively', async () => {
    await expect(async () => {
      const { callTool } = await import('@sahayak/core');
      const conv = (await admin.query("SELECT id FROM conversations WHERE contact='+919300000098'"))
        .rows[0].id;
      await callTool(
        env.rt,
        { clinicId: c.clinicId, actor: { kind: 'agent', agent: 'leads' } },
        'send_message',
        { conversationId: conv, text: 'Come back!', proactive: true },
      );
    }).rejects.toThrow(/not consented/);
  });
});
