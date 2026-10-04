import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, makePool } from '@sahayak/db';
import {
  EventBus,
  callTool,
  parseClinicQuestion,
  parseRange,
  registerAllTools,
  type ToolContext,
} from '@sahayak/core';
import { LlmGate, handleInbound } from '../src';

const TODAY = '2026-10-07'; // a Wednesday
describe('understanding questions', () => {
  it.each([
    ['how many patients today?', 'seen', '2026-10-07', '2026-10-07'],
    ['how many patients this week', 'seen', '2026-10-05', '2026-10-07'],
    ["who didn't show up yesterday", 'no_shows', '2026-10-06', '2026-10-06'],
    ['no shows last week', 'no_shows', '2026-09-28', '2026-10-04'],
    ['kal kaun nahi aaye', 'no_shows', '2026-10-06', '2026-10-06'],
    ['कल कितने मरीज़ आए', 'seen', '2026-10-06', '2026-10-06'],
    ['appointments tomorrow', 'upcoming', '2026-10-08', '2026-10-08'],
    ['kal ke appointments', 'upcoming', '2026-10-08', '2026-10-08'],
    ['average waiting time this month', 'wait', '2026-10-01', '2026-10-07'],
    ['busiest hours last 30 days', 'busiest', '2026-09-08', '2026-10-07'],
    ['new patients last month', 'new_patients', '2026-09-01', '2026-09-30'],
    ['cancellations today', 'cancellations', '2026-10-07', '2026-10-07'],
    ['any open alerts?', 'flags', '2026-10-07', '2026-10-07'],
  ])('%s', (q, metric, from, to) => {
    const p = parseClinicQuestion(q, TODAY)!;
    expect([p.metric, p.range.from, p.range.to]).toEqual([metric, from, to]);
  });
  it('does not guess at things it does not know', () => {
    expect(parseClinicQuestion('what is the meaning of life', TODAY)).toBeNull();
    expect(parseRange('hello', TODAY).from).toBe(TODAY);
  });
});

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
const rt = { pool, bus: new EventBus('') };
const env = { rt, gate: new LlmGate(null) };
let c: Awaited<ReturnType<typeof createTestClinic>>;
let doc1: ToolContext, doc2: ToolContext, rec: ToolContext;
const ids: Record<string, string> = {};
let today = '';
const ask = async (ctx: ToolContext, question: string) =>
  (await callTool(rt, ctx, 'ask_clinic', { question })).answer as string;

beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  c = await createTestClinic(admin, 'ask');
  today = (
    await admin.query("SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date,'YYYY-MM-DD') d")
  ).rows[0].d;
  const mk = async (role: string, doc: string | null, email: string) =>
    (
      await admin.query(
        "INSERT INTO staff_users (clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,'x',$3,$4,$5) RETURNING id",
        [c.clinicId, `${email}-${c.slug}@t.in`, email, role, doc],
      )
    ).rows[0].id as string;
  const u1 = await mk('doctor', c.doctorIds[0], 'd1'),
    u2 = await mk('doctor', c.doctorIds[1], 'd2'),
    ur = await mk('receptionist', null, 'r');
  doc1 = {
    clinicId: c.clinicId,
    actor: { kind: 'staff', role: 'doctor', userId: u1, doctorId: c.doctorIds[0] },
  };
  doc2 = {
    clinicId: c.clinicId,
    actor: { kind: 'staff', role: 'doctor', userId: u2, doctorId: c.doctorIds[1] },
  };
  rec = { clinicId: c.clinicId, actor: { kind: 'staff', role: 'receptionist', userId: ur } };
  for (const [k, n] of [
    ['a', 'Asha'],
    ['b', 'Bala'],
    ['c', 'Chitra'],
    ['d', 'Dev'],
  ])
    ids[k] = await addPatient(admin, c.clinicId, n, `+9197000000${k.charCodeAt(0)}`);
  // today: Asha + Bala seen by doctor 1 (wait 10 min, consult 20 min), Chitra seen by doctor 2
  const q = (
    p: string,
    d: string,
    tok: number,
    status: string,
    waitMin: number,
    consultMin: number,
  ) =>
    admin.query(
      `INSERT INTO queue_entries (clinic_id,doctor_id,patient_id,queue_date,token_number,position_key,status,checked_in_at,called_at,finished_at)
      VALUES ($1,$2,$3,$4::date,$5::int,$5::int,$6, now() - make_interval(mins => $7::int + $8::int), now() - make_interval(mins => $8::int), now())`,
      [c.clinicId, d, ids[p], today, tok, status, waitMin, consultMin],
    );
  await q('a', c.doctorIds[0], 1, 'done', 10, 20);
  await q('b', c.doctorIds[0], 2, 'done', 10, 20);
  await q('c', c.doctorIds[1], 3, 'done', 30, 10);
  // Dev did not show up today for doctor 1; one cancellation; two appointments tomorrow
  await admin.query(
    "INSERT INTO appointments (clinic_id,doctor_id,patient_id,starts_at,ends_at,status) VALUES ($1,$2,$3, now(), now() + interval '15 min', 'no_show')",
    [c.clinicId, c.doctorIds[0], ids.d],
  );
  await admin.query(
    "INSERT INTO appointments (clinic_id,doctor_id,patient_id,starts_at,ends_at,status) VALUES ($1,$2,$3, now(), now() + interval '15 min', 'cancelled')",
    [c.clinicId, c.doctorIds[1], ids.c],
  );
  await admin.query(
    "INSERT INTO appointments (clinic_id,doctor_id,patient_id,starts_at,ends_at) VALUES ($1,$2,$3, now() + interval '1 day', now() + interval '1 day 15 min'), ($1,$4,$5, now() + interval '1 day 1 hour', now() + interval '1 day 1 hour 15 min')",
    [c.clinicId, c.doctorIds[0], ids.a, c.doctorIds[1], ids.b],
  );
});
afterAll(async () => {
  await dropTestClinic(admin, c.clinicId);
  await admin.end();
  await pool.end();
});

describe('Ask your clinic', () => {
  it('a doctor sees their own patients; "clinic" widens it; the receptionist sees everything', async () => {
    expect(await ask(doc1, 'how many patients today?')).toBe('2 patient(s) seen today.');
    expect(await ask(doc2, 'how many patients today?')).toBe('1 patient(s) seen today.');
    expect(await ask(doc1, 'how many patients today in the whole clinic?')).toBe(
      '3 patient(s) seen today.',
    );
    expect(await ask(rec, 'how many patients today?')).toBe('3 patient(s) seen today.');
  });
  it('who did not show up, with names', async () => {
    expect(await ask(doc1, "who didn't show up today")).toBe('1 no-show(s) today: Dev.');
    expect(await ask(doc2, "who didn't show up today")).toBe('No no-shows today.');
  });
  it('waiting and consultation time, busiest hours, cancellations, tomorrow', async () => {
    expect(await ask(doc1, 'average waiting time today')).toMatch(/10 minutes \(from 2 visits\)/);
    expect(await ask(doc1, 'average consultation time today')).toMatch(/20 minutes/);
    expect(await ask(rec, 'busiest hours today')).toMatch(/Busiest hours today: \d+(am|pm) \(\d\)/);
    expect(await ask(doc2, 'cancellations today')).toBe('1 cancellation(s) today.');
    expect(await ask(rec, 'appointments tomorrow')).toMatch(
      /2 appointment\(s\) tomorrow: Asha, Bala/,
    );
    expect(await ask(doc1, 'new patients today')).toBe('4 new patient(s) today.');
  });
  it('answers in Hindi when asked in Hindi', async () => {
    expect(await ask(doc1, 'आज कितने मरीज़ आए')).toBe('आज 2 मरीज़ देखे गए।');
  });
  it('explains what it can do when it does not understand', async () => {
    expect(await ask(doc1, 'tell me a joke')).toMatch(/I can answer questions like/);
  });
  it('is read-only and never leaks another clinic', async () => {
    const other = await createTestClinic(admin, 'ask2');
    const oid = (
      await admin.query(
        "INSERT INTO staff_users (clinic_id,email,password_hash,name,role) VALUES ($1,$2,'x','R','receptionist') RETURNING id",
        [other.clinicId, `r-${other.slug}@t.in`],
      )
    ).rows[0].id;
    expect(
      await ask(
        { clinicId: other.clinicId, actor: { kind: 'staff', role: 'receptionist', userId: oid } },
        'how many patients today?',
      ),
    ).toBe('0 patient(s) seen today.');
    await dropTestClinic(admin, other.clinicId);
    const log = (
      await admin.query("SELECT input FROM agent_actions WHERE tool='ask_clinic' LIMIT 1")
    ).rows[0];
    expect(Object.keys(log.input)).toEqual(['question']);
  });
  it('a model is only used to pick from the fixed list of questions', async () => {
    const llm = {
      name: 'x',
      chat: async () => ({ content: '{"metric": "cancellations"}', toolCalls: [] }),
    };
    const { answerStaffQuestion } = await import('../src');
    const out = await answerStaffQuestion(
      { rt, gate: new LlmGate(llm as any) },
      doc2,
      'umm how are we doing on people backing out',
    );
    expect(out).toBe('1 cancellation(s) today.');
    const bad = {
      name: 'x',
      chat: async () => ({ content: '{"metric": "DROP TABLE patients"}', toolCalls: [] }),
    };
    expect(
      await answerStaffQuestion({ rt, gate: new LlmGate(bad as any) }, doc2, 'umm gibberish blah'),
    ).toMatch(/I can answer questions like/);
  });
});

describe('Ask over WhatsApp from a staff number', () => {
  const phone = '+919800000001';
  it('a registered staff number gets answers; the same words from a patient number do not', async () => {
    await callTool(rt, doc1, 'set_my_phone', { phone });
    const r = await handleInbound(env, {
      clinicId: c.clinicId,
      from: phone,
      text: 'how many patients today?',
    });
    expect(r.replies[0]).toBe('2 patient(s) seen today.');
    const r2 = await handleInbound(env, {
      clinicId: c.clinicId,
      from: '+919800000099',
      text: 'how many patients today?',
    });
    expect(r2.replies[0]).not.toMatch(/seen today/);
    const brief = await handleInbound(env, { clinicId: c.clinicId, from: phone, text: 'brief' });
    expect(brief.replies[0]).toMatch(/Daily summary for Clinic/);
    expect(brief.replies[0]).toMatch(/Patients seen: 2/);
  });
  it('emergency words still trigger the safety path first', async () => {
    const r = await handleInbound(env, { clinicId: c.clinicId, from: phone, text: 'chest pain' });
    expect(r.redFlag).toBe(true);
  });
});

describe('Daily brief', () => {
  it('is sent once a day after the configured time, only to staff with a number, only when enabled', async () => {
    const sys = { clinicId: c.clinicId, actor: { kind: 'system' as const } };
    await callTool(rt, rec, 'set_my_phone', { phone: '+919800000002' });
    expect(await callTool(rt, sys, 'send_daily_briefs', {})).toEqual({ sent: 0 }); // disabled by default
    await admin.query(
      `UPDATE clinic_settings SET brief='{"enabled": true, "time": "23:59"}' WHERE clinic_id=$1`,
      [c.clinicId],
    );
    const hm = (await admin.query("SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','HH24:MI') hm"))
      .rows[0].hm;
    if (hm < '23:59') expect(await callTool(rt, sys, 'send_daily_briefs', {})).toEqual({ sent: 0 }); // too early
    await admin.query(
      `UPDATE clinic_settings SET brief='{"enabled": true, "time": "00:00"}' WHERE clinic_id=$1`,
      [c.clinicId],
    );
    expect(await callTool(rt, sys, 'send_daily_briefs', {})).toEqual({ sent: 2 });
    expect(await callTool(rt, sys, 'send_daily_briefs', {})).toEqual({ sent: 0 }); // once per day
    const m = await admin.query(
      "SELECT body FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE v.contact='+919800000002' AND m.sender='agent:brief'",
    );
    expect(m.rows[0].body).toMatch(/Patients seen: 3/); // receptionist sees the whole clinic
    const d = await admin.query(
      "SELECT body FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE v.contact='+919800000001' AND m.sender='agent:brief'",
    );
    expect(d.rows[0].body).toMatch(/Patients seen: 2/); // doctor sees their own
    expect(d.rows[0].body).toMatch(/No-shows: 1: Dev/);
  });
  it('validates phone numbers and brief time', async () => {
    await expect(callTool(rt, doc1, 'set_my_phone', { phone: '98765' })).rejects.toThrow();
    await expect(
      callTool(rt, doc1, 'update_clinic_settings', { brief: { enabled: true, time: '25:00' } }),
    ).rejects.toThrow();
  });
});
