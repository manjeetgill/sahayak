import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, makePool, withClinic } from '@sahayak/db';
import { EventBus, callTool, registerAllTools, type ToolContext } from '@sahayak/core';
import { LlmGate, handleInbound, parseLateMinutes } from '../src';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
const rt = { pool, bus: new EventBus('') };
const env = { rt, gate: new LlmGate(null) };
let c: Awaited<ReturnType<typeof createTestClinic>>;
let doctorCtx: ToolContext, recCtx: ToolContext;
const ids: Record<string, string> = {};
const phones = { p1: '+919200000001', p2: '+919200000002', p3: '+919200000003' };
const istHour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }));
const nearMidnight = istHour >= 22; // the test clinic is open until 23:45 IST; shifting past it is a different scenario

beforeAll(async () => {
  await admin.connect(); registerAllTools();
  c = await createTestClinic(admin, 'sched');
  const staff = (await admin.query("INSERT INTO staff_users (clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,'x','Doc','doctor',$3) RETURNING id", [c.clinicId, `d-${c.slug}@t.in`, c.doctorIds[0]])).rows[0].id;
  doctorCtx = { clinicId: c.clinicId, actor: { kind: 'staff', role: 'doctor', userId: staff, doctorId: c.doctorIds[0] } };
  recCtx = { clinicId: c.clinicId, actor: { kind: 'staff', role: 'receptionist', userId: staff } };
  ids.p1 = await addPatient(admin, c.clinicId, 'Pat One', phones.p1);
  ids.p2 = await addPatient(admin, c.clinicId, 'Pat Two', phones.p2);
  ids.p3 = await addPatient(admin, c.clinicId, 'Pat Three', phones.p3, { whatsapp: false });
});
afterAll(async () => { await dropTestClinic(admin, c.clinicId); await admin.end(); await pool.end(); });
const msgs = (phone: string) => withClinic(pool, c.clinicId, async (db) => (await db.query("SELECT m.body, m.direction FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE v.contact=$1 ORDER BY m.created_at", [phone])).rows as { body: string; direction: string }[]);
const say = (from: string, text: string) => handleInbound(env, { clinicId: c.clinicId, from, text });

describe('parseLateMinutes', () => {
  it.each([['running 30 minutes late', 30], ['I am 45 min late', 45], ['half an hour late', 30], ['1 hour late', 60], ['आधा घंटा देर हो जाएगी', 30], ['20 मिनट देर', 20], ['hello', null], ['30 minutes', null]])('%s', (t, m) => expect(parseLateMinutes(t as string)).toBe(m));
});

describe.skipIf(nearMidnight)('Running-late flow (doctor confirms with one tap)', () => {
  let proposalId: string;
  it('proposal computes impact and sends NOTHING before confirmation', async () => {
    for (const [i, p] of (['p1', 'p2', 'p3'] as const).entries()) {
      await admin.query("INSERT INTO appointments (clinic_id,doctor_id,patient_id,starts_at,ends_at) VALUES ($1,$2,$3, date_trunc('minute', now()) + make_interval(mins => $4), date_trunc('minute', now()) + make_interval(mins => $4 + 15))", [c.clinicId, c.doctorIds[0], ids[p], 20 + i * 15]);
    }
    const out = await callTool(rt, doctorCtx, 'propose_schedule_shift', { minutes: 30, requestedText: 'running 30 min late' });
    proposalId = out.proposalId;
    expect(out.affected).toBe(3);
    expect((await msgs(phones.p1)).length).toBe(0);
    expect((await msgs(phones.p2)).length).toBe(0);
  });
  it('an agent cannot confirm on the doctor\'s behalf', async () => {
    await expect(callTool(rt, { clinicId: c.clinicId, actor: { kind: 'agent', agent: 'schedule' } }, 'confirm_schedule_shift', { proposalId })).rejects.toThrow(/may not call/);
    await expect(callTool(rt, recCtx, 'confirm_schedule_shift', { proposalId })).rejects.toThrow(/may not call/);
  });
  it('confirm moves appointments, notifies consenting patients and flags the one without consent', async () => {
    const before = (await admin.query('SELECT starts_at FROM appointments WHERE patient_id=$1', [ids.p1])).rows[0].starts_at as Date;
    const out = await callTool(rt, doctorCtx, 'confirm_schedule_shift', { proposalId });
    expect(out).toMatchObject({ moved: 3, notified: 2, noConsent: 1 });
    const after = (await admin.query('SELECT starts_at FROM appointments WHERE patient_id=$1', [ids.p1])).rows[0].starts_at as Date;
    expect(after.getTime() - before.getTime()).toBe(30 * 60_000);
    expect((await msgs(phones.p1)).at(-1)!.body).toMatch(/30 minutes late/);
    expect((await msgs(phones.p3)).length).toBe(0);
    const flags = await withClinic(pool, c.clinicId, async (db) => (await db.query("SELECT summary FROM flags WHERE kind='system'")).rows);
    expect(flags[0].summary).toMatch(/1 patient\(s\) could not be messaged/);
    await expect(callTool(rt, doctorCtx, 'confirm_schedule_shift', { proposalId })).rejects.toThrow(/already handled/); // cannot confirm twice
  });
  it('patients reply: one keeps the new time, one rebooks; doctor sees a live summary', async () => {
    expect((await say(phones.p1, '1')).replies[0]).toMatch(/stays at/);
    const r = await say(phones.p2, '2');
    expect(r.replies[0]).toMatch(/Other slots|Pick a new time/);
    const r2 = await say(phones.p2, '1');
    expect(r2.replies[0]).toMatch(/Done\. Your appointment is now/);
    const s = await callTool(rt, doctorCtx, 'get_shift_summary', {});
    expect(s.counts).toMatchObject({ affected: 3, notified: 2, keptNewTime: 1, rebooked: 1, needsCall: 1, waitingForReply: 0 });
  });
});

describe('Follow-up agent (pg-boss jobs call these tools)', () => {
  it('reminder is sent only for patients with both consents; others are skipped, never messaged', async () => {
    const slots = (await callTool(rt, { clinicId: c.clinicId, actor: { kind: 'agent', agent: 'front_desk' }, patientId: ids.p1 }, 'list_free_slots', { doctorId: c.doctorIds[1], count: 2 })).slots;
    const a1 = await callTool(rt, { clinicId: c.clinicId, actor: { kind: 'agent', agent: 'front_desk' }, patientId: ids.p1 }, 'book_appointment', { doctorId: c.doctorIds[1], patientId: ids.p1, startsAt: slots[0] });
    const a3 = await callTool(rt, recCtx, 'book_appointment', { doctorId: c.doctorIds[1], patientId: ids.p3, startsAt: slots[1] });
    const rows = (await admin.query("SELECT id, patient_id FROM follow_ups WHERE kind='reminder' AND clinic_id=$1", [c.clinicId])).rows;
    expect(rows.length).toBe(1); // p3 gave no reminder consent: none planned
    expect(rows[0].patient_id).toBe(ids.p1);
    const before = (await msgs(phones.p1)).length;
    expect(await callTool(rt, { clinicId: c.clinicId, actor: { kind: 'system' } }, 'run_followup', { followUpId: rows[0].id })).toEqual({ status: 'sent' });
    expect((await msgs(phones.p1)).length).toBe(before + 1);
    // Withdrawn consent: queued reminder is skipped.
    await admin.query("UPDATE consents SET withdrawn_at=now() WHERE patient_id=$1 AND purpose='whatsapp_messaging'", [ids.p3]);
    const f = await callTool(rt, recCtx, 'schedule_followup', { patientId: ids.p3, kind: 'post_visit', runAt: new Date().toISOString() });
    expect((await callTool(rt, { clinicId: c.clinicId, actor: { kind: 'system' } }, 'run_followup', { followUpId: f.followUpId })).status).toBe('skipped');
    expect((await msgs(phones.p3)).length).toBe(0);
    void a1; void a3;
  });
  it('post-visit reply that says "not better" raises an urgent item for the doctor team', async () => {
    const f = await callTool(rt, recCtx, 'schedule_followup', { patientId: ids.p2, kind: 'post_visit', runAt: new Date().toISOString() });
    await callTool(rt, { clinicId: c.clinicId, actor: { kind: 'system' } }, 'run_followup', { followUpId: f.followUpId });
    const r = await say(phones.p2, 'I am not better, the pain is increasing');
    expect(r.replies[0]).toMatch(/alerted the doctor/);
    const flags = await withClinic(pool, c.clinicId, async (db) => (await db.query("SELECT severity, summary FROM flags WHERE summary LIKE '%worsening%'")).rows);
    expect(flags[0].severity).toBe('urgent');
  });
  it('recall goes only to consenting patients not seen for 90+ days', async () => {
    await admin.query("INSERT INTO queue_entries (clinic_id,doctor_id,patient_id,queue_date,token_number,position_key,status) VALUES ($1,$2,$3, now()::date - 120, 1, 1, 'done')", [c.clinicId, c.doctorIds[0], ids.p1]);
    await admin.query("INSERT INTO queue_entries (clinic_id,doctor_id,patient_id,queue_date,token_number,position_key,status) VALUES ($1,$2,$3, now()::date - 120, 2, 2, 'done')", [c.clinicId, c.doctorIds[0], ids.p3]);
    await admin.query("UPDATE appointments SET status='cancelled' WHERE patient_id=$1", [ids.p1]);
    const out = await callTool(rt, { clinicId: c.clinicId, actor: { kind: 'system' } }, 'queue_recalls', {});
    expect(out.queued).toBe(1); // p3 never consented
    const due = (await admin.query("SELECT id FROM follow_ups WHERE kind='recall' AND clinic_id=$1", [c.clinicId])).rows;
    expect((await callTool(rt, { clinicId: c.clinicId, actor: { kind: 'system' } }, 'run_followup', { followUpId: due[0].id })).status).toBe('sent');
    expect((await msgs(phones.p1)).at(-1)!.body).toMatch(/check-up/);
  });
});

describe('Queue agent no-show handling', () => {
  it('nudges at 8 minutes, marks no-show at 15, tells the receptionist', async () => {
    const ci = await callTool(rt, { clinicId: c.clinicId, actor: { kind: 'patient' } }, 'check_in_patient', { phone: phones.p2, doctorId: c.doctorIds[0], language: 'en', consent: {} });
    await callTool(rt, doctorCtx, 'call_next_patient', {});
    await admin.query("UPDATE queue_entries SET called_at = now() - interval '9 minutes' WHERE id=$1", [ci.queueEntryId]);
    const sys = { clinicId: c.clinicId, actor: { kind: 'system' as const } };
    expect(await callTool(rt, sys, 'sweep_no_shows', {})).toEqual({ nudged: 1, noShows: 0 });
    expect(await callTool(rt, sys, 'sweep_no_shows', {})).toEqual({ nudged: 0, noShows: 0 }); // nudged once only
    await admin.query("UPDATE queue_entries SET called_at = now() - interval '16 minutes' WHERE id=$1", [ci.queueEntryId]);
    expect(await callTool(rt, sys, 'sweep_no_shows', {})).toEqual({ nudged: 0, noShows: 1 });
    expect((await admin.query('SELECT status FROM queue_entries WHERE id=$1', [ci.queueEntryId])).rows[0].status).toBe('no_show');
  });
  it('a patient cannot jump the queue by asking', async () => {
    const r = await say(phones.p1, 'please put me first in the queue');
    expect(r.replies[0]).toMatch(/can't change it/);
  });
});
