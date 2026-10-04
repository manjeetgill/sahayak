import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, makePool } from '@sahayak/db';
import { EventBus, registerAllTools } from '@sahayak/core';
import { LlmGate, handleInbound, parseSlotPreference } from '../src';

const TZ = 'Asia/Kolkata';
// Monday 2026-10-05 10:00 IST
const NOW = new Date('2026-10-05T04:30:00Z');

describe('parseSlotPreference', () => {
  const p = (t: string) => parseSlotPreference(t, TZ, NOW);
  it.each([
    ['tomorrow evening', { date: '2026-10-06', from: '16:00', to: '21:00' }],
    ['kal subah', { date: '2026-10-06', from: '06:00', to: '12:00' }],
    ['कल शाम', { date: '2026-10-06', from: '16:00', to: '21:00' }],
    ['today', { date: '2026-10-05' }],
    ['aaj dopahar', { date: '2026-10-05', from: '12:00', to: '16:00' }],
    ['Friday 5 pm', { date: '2026-10-09', from: '17:00' }],
    ['friday after 4', { date: '2026-10-09', from: '16:00' }],
    ['शुक्रवार 4 बजे के बाद', { date: '2026-10-09', from: '16:00' }],
    ['next monday', { date: '2026-10-12' }],
    ['day after tomorrow', { date: '2026-10-07' }],
    ['parso 11 am', { date: '2026-10-07', from: '11:00' }],
    ['12 oct at 9 am', { date: '2026-10-12', from: '09:00' }],
    ['before 12 tomorrow', { date: '2026-10-06', to: '12:00' }],
    ['earliest', { asap: true }],
    ['jaldi se jaldi', { asap: true }],
    ['any time', { asap: true }],
  ])('%s', (text, want) => expect(p(text)).toEqual(want));
  it.each(['hello', 'my name is Ravi', 'I need help'])('ignores: %s', (t) =>
    expect(p(t)).toBeNull(),
  );
});

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
const bus = new EventBus('');
const env = { rt: { pool, bus }, gate: new LlmGate(null) };
let c: Awaited<ReturnType<typeof createTestClinic>>;
const say = (from: string, text: string, doctorId?: string) =>
  handleInbound(env, { clinicId: c.clinicId, from, text, doctorId });
const booked = (phone: string) =>
  admin
    .query(
      'SELECT a.starts_at, a.doctor_id, a.status FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE p.phone=$1 ORDER BY a.created_at',
      [phone],
    )
    .then((r) => r.rows);

beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  c = await createTestClinic(admin, 'bkg');
  await addPatient(admin, c.clinicId, 'Book Pt', '+919500000001');
  await addPatient(admin, c.clinicId, 'Book Pt2', '+919500000002');
});
afterAll(async () => {
  await dropTestClinic(admin, c.clinicId);
  await admin.end();
  await pool.end();
});

describe('conversational booking: no human involved', () => {
  it('asks day/time, searches existing appointments, offers the next free slots, books on a number', async () => {
    let r = await say('+919500000001', 'I need an appointment', c.doctorIds[0]);
    expect(r.replies[0]).toMatch(/Which day and time suits you with Dr\. Test One/); // doctor known from the number: not asked
    r = await say('+919500000001', 'tomorrow evening');
    expect(r.replies[0]).toMatch(/Available slots with Dr\. Test One: 1\).*; 2\).*; 3\)/);
    r = await say('+919500000001', '2');
    expect(r.replies[0]).toMatch(/is booked for/);
    const rows = await booked('+919500000001');
    expect(rows).toHaveLength(1);
    expect(rows[0].doctor_id).toBe(c.doctorIds[0]);
    const hour = Number(
      new Date(rows[0].starts_at).toLocaleString('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        hour12: false,
      }),
    );
    expect(hour).toBeGreaterThanOrEqual(16); // really an evening slot
  });
  it('a taken slot is never offered again (next patient gets different times)', async () => {
    const first = (await booked('+919500000001'))[0].starts_at as Date;
    const r = await say('+919500000002', 'book an appointment tomorrow evening', c.doctorIds[0]); // preference given up front: no question
    expect(r.replies[0]).toMatch(/Available slots/);
    await say('+919500000002', '1');
    const second = (await booked('+919500000002'))[0].starts_at as Date;
    expect(second.getTime()).not.toBe(first.getTime());
  });
  it('without a doctor number the patient picks a doctor, then says when', async () => {
    await admin.query("UPDATE conversations SET doctor_id=NULL WHERE contact='+919500000001'");
    await admin.query("UPDATE appointments SET status='cancelled' WHERE status='booked'");
    let r = await say('+919500000001', 'appointment chahiye');
    expect(r.replies[0]).toMatch(/Which doctor/);
    r = await say('+919500000001', '2');
    expect(r.replies[0]).toMatch(/Which day and time suits you with Dr\. Test Two/);
  });
  it('unclear answer gets one re-ask, then the earliest slots', async () => {
    let r = await say('+919500000001', 'umm not sure');
    expect(r.replies[0]).toMatch(/didn't catch the day or time/);
    r = await say('+919500000001', 'whatever you say');
    expect(r.replies[0]).toMatch(/Available slots with Dr\. Test Two/);
  });
  it('"Friday instead" restarts the search for the same doctor', async () => {
    const r = await say('+919500000001', 'friday morning');
    expect(r.replies[0]).toMatch(/Dr\. Test Two/);
    expect(r.replies[0]).toMatch(/Fri/);
  });
  it('Hindi: asks and books in Hindi', async () => {
    await admin.query("UPDATE appointments SET status='cancelled' WHERE status='booked'");
    await admin.query("UPDATE conversations SET state='{}' WHERE contact='+919500000002'");
    let r = await say('+919500000002', 'मुझे अपॉइंटमेंट चाहिए कल सुबह', c.doctorIds[0]);
    expect(r.replies[0]).toMatch(/के साथ उपलब्ध स्लॉट/);
    r = await say('+919500000002', '1');
    expect(r.replies[0]).toMatch(/बुक हो गया है/);
  });
  it("the doctor's screen is told live when the agent books", async () => {
    const seen: string[] = [];
    const off = bus.subscribe(c.clinicId, (e) => seen.push(e.type));
    await say('+919500000001', 'cancel my appointment'); // nothing booked: harmless
    await admin.query("UPDATE conversations SET state='{}' WHERE contact='+919500000002'");
    await say('+919500000002', 'book appointment friday', c.doctorIds[0]);
    await say('+919500000002', '1');
    off();
    expect(seen).toContain('queue_changed');
  });
});

describe('closed hours: nearest options, with an honest message', () => {
  let c2: Awaited<ReturnType<typeof createTestClinic>>;
  beforeAll(async () => {
    c2 = await createTestClinic(admin, 'bkg2');
    const morning = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, '09:00-13:00']),
    );
    await admin.query('UPDATE clinic_settings SET timings=$2 WHERE clinic_id=$1', [
      c2.clinicId,
      JSON.stringify(morning),
    ]);
    await admin.query('DELETE FROM doctors WHERE id=$1', [c2.doctorIds[1]]);
    await addPatient(admin, c2.clinicId, 'Closed Pt', '+919500000003');
  });
  afterAll(async () => {
    await dropTestClinic(admin, c2.clinicId);
  });
  it('evening request at a morning-only clinic says nothing is free then, and offers the nearest', async () => {
    const r1 = await handleInbound(env, {
      clinicId: c2.clinicId,
      from: '+919500000003',
      text: 'book appointment tomorrow evening',
    });
    expect(r1.replies[0]).toMatch(
      /Nothing is free at that time\. The nearest options with Dr\. Test One/,
    );
  });
});

describe("unknown caller on a doctor's number", () => {
  it('collects name and consent, remembers the requested time, then books', async () => {
    const from = '+919500000077';
    let r = await say(from, 'I need an appointment tomorrow morning', c.doctorIds[0]);
    expect(r.replies[0]).toMatch(/your name/);
    r = await say(from, 'Meena Kumari');
    expect(r.replies[0]).toMatch(/Reply YES/);
    r = await say(from, 'yes');
    expect(r.replies[0]).toMatch(/Available slots with Dr\. Test One/); // used "tomorrow morning" from the first message
    r = await say(from, '1');
    expect(r.replies[0]).toMatch(/is booked for/);
  });
});

describe('reminder consent right after booking', () => {
  const book = async (phone: string) => {
    await say(phone, 'book an appointment tomorrow morning', c.doctorIds[0]);
    return say(phone, '1');
  };
  it('asks once; YES records both consents and schedules the reminder', async () => {
    const phone = '+919500000091';
    await addPatient(admin, c.clinicId, 'No Consent', phone, { whatsapp: false });
    const r = await book(phone);
    expect(r.replies.join(' ')).toMatch(/Would you like a WhatsApp reminder/);
    const yes = await say(phone, 'yes');
    expect(yes.replies[0]).toMatch(/remind you/);
    const consents = await admin.query(
      'SELECT purpose FROM consents WHERE patient_id=(SELECT id FROM patients WHERE phone=$1) AND withdrawn_at IS NULL ORDER BY purpose',
      [phone],
    );
    expect(consents.rows.map((x) => x.purpose)).toEqual([
      'reminders_followups',
      'visit_data',
      'whatsapp_messaging',
    ]);
    const f = await admin.query(
      'SELECT kind, status FROM follow_ups WHERE patient_id=(SELECT id FROM patients WHERE phone=$1)',
      [phone],
    );
    expect(f.rows).toEqual([{ kind: 'reminder', status: 'pending' }]);
  });
  it('NO records nothing and schedules nothing', async () => {
    const phone = '+919500000092';
    await addPatient(admin, c.clinicId, 'Declines', phone, { whatsapp: false });
    await book(phone);
    const no = await say(phone, 'no');
    expect(no.replies[0]).toMatch(/no reminders/);
    const n = await admin.query(
      "SELECT count(*)::int n FROM consents WHERE patient_id=(SELECT id FROM patients WHERE phone=$1) AND purpose<>'visit_data'",
      [phone],
    );
    expect(n.rows[0].n).toBe(0);
  });
  it('patients who already consented are not asked again', async () => {
    const r = await book('+919500000002');
    expect(r.replies.join(' ')).not.toMatch(/reminder/i);
  });
  it('ignoring the question and asking something else just moves on', async () => {
    const phone = '+919500000093';
    await addPatient(admin, c.clinicId, 'Ignores', phone, { whatsapp: false });
    await book(phone);
    const r = await say(phone, 'what are your timings');
    expect(r.replies[0]).toMatch(/Clinic timings/);
  });
});
