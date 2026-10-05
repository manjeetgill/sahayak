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
