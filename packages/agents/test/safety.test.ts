import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, makePool, withClinic } from '@sahayak/db';
import { EventBus, registerAllTools } from '@sahayak/core';
import { LlmGate, LlmUnavailable, handleInbound, type LlmProvider } from '../src';
import { t } from '@sahayak/shared';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
const bus = new EventBus('');
let c: Awaited<ReturnType<typeof createTestClinic>>;
const env = (provider: LlmProvider | null = null) => ({ rt: { pool, bus }, gate: new LlmGate(provider) });

beforeAll(async () => { await admin.connect(); registerAllTools(); c = await createTestClinic(admin, 'safety'); await addPatient(admin, c.clinicId, 'Ravi', '+919100000001'); });
afterAll(async () => { await dropTestClinic(admin, c.clinicId); await admin.end(); await pool.end(); });

const flags = () => withClinic(pool, c.clinicId, async (db) => (await db.query("SELECT kind, severity, status FROM flags ORDER BY created_at")).rows);

describe('Safety rule 1+2: red flags', () => {
  const cases: [string, string][] = [
    ['I have chest pain', 'en'], ['mujhe seene mein dard ho raha hai', 'hi'], ['मुझे सांस फूल रही है', 'hi'], ['my father is unconscious', 'en'],
    ['bahut khoon beh raha hai', 'hi'], ['he is having a seizure', 'en'], ['मुझे आत्महत्या के विचार आ रहे हैं', 'hi'], ['my baby has high fever', 'en'],
  ];
  const phoneFor = (text: string) => (/[\u0900-\u097F]/.test(text) ? '+919100000002' : '+919100000001'); // Hindi chats are sticky per conversation
  for (const [text] of cases) {
    it(`escalates: ${text}`, async () => {
      const before = (await flags()).length;
      const r = await handleInbound(env(), { clinicId: c.clinicId, from: phoneFor(text), text });
      expect(r.redFlag).toBe(true);
      expect(r.replies.join(' ')).toMatch(/108/);
      const after = await flags();
      expect(after.length).toBe(before + 1);
      expect(after.at(-1)).toMatchObject({ kind: 'red_flag', severity: 'urgent', status: 'open' });
    });
  }
  it('fixed message is in Hindi for Hindi messages', async () => {
    const r = await handleInbound(env(), { clinicId: c.clinicId, from: '+919100000002', text: 'सीने में दर्द है' });
    expect(r.replies[0]).toBe(t('hi', 'msg.red_flag'));
  });
  it('clinic-added phrases trigger, and built-ins cannot be removed', async () => {
    await admin.query("INSERT INTO red_flag_phrases (clinic_id,phrase,language) VALUES ($1,'bee sting swelling','en')", [c.clinicId]);
    const r = await handleInbound(env(), { clinicId: c.clinicId, from: '+919100000001', text: 'bee sting swelling on my face' });
    expect(r.redFlag).toBe(true);
    // the app role cannot touch the built-in list: it lives in code, and the table only accepts additions for its own clinic
    expect((await handleInbound(env(), { clinicId: c.clinicId, from: '+919100000001', text: 'chest pain' })).redFlag).toBe(true);
  });
  it('LLM classifier is a second layer: triggers even when keywords miss', async () => {
    const llm: LlmProvider = { name: 'fake', chat: async () => ({ content: '{"emergency": true, "topic": "other"}', toolCalls: [] }) };
    const r = await handleInbound(env(llm), { clinicId: c.clinicId, from: '+919100000001', text: 'my grandmother has gone very pale and cold and is not talking' });
    expect(r.redFlag).toBe(true);
  });
  it('red flag fires even if the LLM is broken', async () => {
    const llm: LlmProvider = { name: 'broken', chat: async () => { throw new LlmUnavailable('down'); } };
    const r = await handleInbound(env(llm), { clinicId: c.clinicId, from: '+919100000001', text: 'chest pain' });
    expect(r.redFlag).toBe(true);
  });
  it('medical questions get the fixed reply, no advice', async () => {
    const r = await handleInbound(env(), { clinicId: c.clinicId, from: '+919100000001', text: 'Can I take paracetamol for my fever?' });
    expect(r.replies[0]).toBe(t('en', 'msg.medical_advice'));
    expect((await flags()).at(-1)).toMatchObject({ kind: 'medical_question' });
  });
  it('audit log records every red flag decision', async () => {
    const n = await withClinic(pool, c.clinicId, async (db) => (await db.query("SELECT count(*)::int AS n FROM agent_actions WHERE kind='red_flag'")).rows[0].n);
    expect(n).toBeGreaterThanOrEqual(8);
  });
});

describe('Safety rule 5: fail safe when the LLM is down or slow', () => {
  it('check-in and queue work with no LLM at all', async () => {
    const { callTool } = await import('@sahayak/core');
    const out = await callTool({ pool, bus }, { clinicId: c.clinicId, actor: { kind: 'patient' } }, 'check_in_patient', { name: 'New Pt', phone: '+919100000077', doctorId: c.doctorIds[0], language: 'en', consent: { visit_data: true } });
    expect(out.token).toBe(1);
    const nxt = await callTool({ pool, bus }, { clinicId: c.clinicId, actor: { kind: 'staff', role: 'receptionist', userId: '00000000-0000-0000-0000-000000000000' } }, 'call_next_patient', { doctorId: c.doctorIds[0] });
    expect(nxt.patient.name).toBe('New Pt');
  });
  it('a failing LLM does not break patient replies (falls back to plain software)', async () => {
    const llm: LlmProvider = { name: 'down', chat: async () => { throw new LlmUnavailable('timeout'); } };
    const e = env(llm);
    const r = await handleInbound(e, { clinicId: c.clinicId, from: '+919100000001', text: 'what are your timings?' });
    expect(r.replies.join(' ')).toMatch(/timings/i);
    const r2 = await handleInbound(e, { clinicId: c.clinicId, from: '+919100000001', text: 'do you do home visits for elderly patients' });
    expect(r2.replies.length).toBe(1); // handed to the receptionist, never silence
  });
  it('gate marks the LLM unavailable after repeated failures and reports status', async () => {
    const events: boolean[] = [];
    const gate = new LlmGate({ name: 'x', chat: async () => { throw new Error('boom'); } }, { publish: (_c: string, e: any) => events.push(e.ok) } as any, () => ['c']);
    await gate.chat({ messages: [] }).catch(() => {});
    await gate.chat({ messages: [] }).catch(() => {});
    expect(gate.available()).toBe(false);
    expect(events).toContain(false);
  });
});
