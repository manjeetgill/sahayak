import { beforeAll, afterAll, it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createTestClinic, dropTestClinic, addPatient, makePool, withClinic } from '@sahayak/db';
import { EventBus, callTool, enqueueAgentEvents, doctorAssistantEnabled } from '@sahayak/core';
import { LlmGate, handleInbound, handleCallTurn } from '@sahayak/agents';
import { buildApp } from '../src/app';
const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL }),
  pool = makePool();
let clinic: Awaited<ReturnType<typeof createTestClinic>>,
  other: typeof clinic,
  app: Awaited<ReturnType<typeof buildApp>>;
const users: Record<string, any> = {};
const rt = { pool, bus: new EventBus('') };
const env = { rt, gate: new LlmGate(null) };
let patient1: string, patient2: string, personalId: string;
const auth = (role = 'doctor') => ({ authorization: 'Bearer ' + app.jwt.sign(users[role]) });
const request = (method: any, url: string, payload?: any, role = 'doctor') =>
  app.inject({ method, url, headers: auth(role), ...(payload ? { payload } : {}) });
const grant = (kind: string, allowed = true, doctorId = clinic.doctorIds[0]) =>
  request('PUT', '/staff/agents/access', { doctorId, kind, allowed }, 'admin');
const enable = (kind: string, enabled = true) =>
  request('PUT', '/staff/agents/preferences', { kind, enabled });
const spec = {
  trigger: { type: 'event', event: 'visit.finished', delayHours: 0 },
  audience: {},
  action: { type: 'message_patients', text: { en: 'Thank you for visiting {clinic}, {name}.' } },
};
beforeAll(async () => {
  await db.connect();
  clinic = await createTestClinic(db, 'doctorassist');
  other = await createTestClinic(db, 'otherassist');
  for (const role of ['admin', 'doctor', 'second', 'receptionist']) {
    const doctorId =
      role === 'doctor' ? clinic.doctorIds[0] : role === 'second' ? clinic.doctorIds[1] : null;
    const actualRole = role === 'second' ? 'doctor' : role;
    const u = (
      await db.query(
        "INSERT INTO staff_users(clinic_id,email,name,role,password_hash,doctor_id) VALUES($1,$2,$3,$4,'unused',$5) RETURNING id",
        [clinic.clinicId, role + clinic.slug + '@test.invalid', role, actualRole, doctorId],
      )
    ).rows[0];
    users[role] = { uid: u.id, clinicId: clinic.clinicId, role: actualRole, doctorId, name: role };
  }
  patient1 = await addPatient(db, clinic.clinicId, 'First patient', '+919800003001');
  patient2 = await addPatient(db, clinic.clinicId, 'Second patient', '+919800003002');
  for (const [idx, p] of [patient1, patient2].entries())
    await db.query(
      "INSERT INTO appointments(clinic_id,patient_id,doctor_id,starts_at,ends_at,status) VALUES($1,$2,$3,now()+interval '2 days',now()+interval '2 days 15 minutes','booked')",
      [clinic.clinicId, p, clinic.doctorIds[idx]],
    );
  app = await buildApp({
    ...env,
    pool,
    bus: rt.bus,
    gate: env.gate,
    jwtSecret: 'doctor-assistant-tests',
  });
});
afterAll(async () => {
  await app?.close();
  for (const c of [clinic, other]) if (c) await dropTestClinic(db, c.clinicId);
  await pool.end();
  await db.end();
});
it('requires an explicit grant, rejects reception and cross-clinic grants, keeps connection controls admin-only', async () => {
  expect((await request('POST', '/staff/agents', { name: 'My reminders', spec })).statusCode).toBe(
    403,
  );
  expect((await request('GET', '/staff/agents/access', undefined, 'receptionist')).statusCode).toBe(
    403,
  );
  expect(
    (
      await request('PUT', '/staff/agents/access', {
        doctorId: clinic.doctorIds[1],
        kind: 'phone',
        allowed: true,
      })
    ).statusCode,
  ).toBe(403);
  expect((await grant('phone', true, other.doctorIds[0])).statusCode).toBe(404);
  expect((await request('GET', '/staff/agents/connections')).statusCode).toBe(403);
  expect(
    (await request('POST', '/staff/agents/calling/activation', { enabled: true })).statusCode,
  ).toBe(403);
  expect((await grant('reminders')).statusCode).toBe(200);
  const access = (await request('GET', '/staff/agents/access')).json();
  expect(access.doctors).toHaveLength(1);
  expect(access.doctors[0].id).toBe(clinic.doctorIds[0]);
  expect(access.doctors[0].assistants.find((a: any) => a.kind === 'reminders')).toMatchObject({
    allowed: true,
    enabled: false,
  });
});
it('binds ownership from login, prevents cross-doctor changes and previews only the doctor’s patients', async () => {
  const saved = await request('POST', '/staff/agents', {
    name: 'My reminders',
    spec,
    doctorId: clinic.doctorIds[1],
  });
  expect(saved.statusCode).toBe(200);
  personalId = saved.json().agentId;
  expect(
    (await db.query('SELECT doctor_id FROM custom_agents WHERE id=$1', [personalId])).rows[0]
      .doctor_id,
  ).toBe(clinic.doctorIds[0]);
  expect((await request('POST', `/staff/agents/${personalId}/activate`, {})).statusCode).toBe(403);
  await enable('reminders');
  expect((await request('POST', `/staff/agents/${personalId}/activate`, {})).statusCode).toBe(200);
  await grant('reminders', true, clinic.doctorIds[1]);
  expect((await request('GET', '/staff/agents', undefined, 'second')).json().agents).toHaveLength(
    0,
  );
  for (const [method, suffix, payload] of [
    ['PATCH', '', { name: 'Changed' }],
    ['POST', '/pause', {}],
    ['DELETE', '', undefined],
  ] as const)
    expect(
      (await request(method, `/staff/agents/${personalId}${suffix}`, payload, 'second')).statusCode,
    ).toBe(404);
  const preview = (await request('POST', '/staff/agents/preview', { spec })).json();
  expect(preview.audience.count).toBe(1);
  expect(preview.audience.sample).toEqual(['First']);
  expect(
    (
      await request('POST', '/staff/agents/preview', {
        spec: {
          ...spec,
          action: { type: 'notify_staff', to: 'both', text: { en: 'Visit complete' } },
        },
      })
    ).statusCode,
  ).toBe(400);
});
it('executes a doctor reminder for their patient only and keeps the other patient untouched', async () => {
  const offset = new Date().getUTCHours() - 12;
  const tz = 'Etc/GMT' + (offset >= 0 ? '+' : '') + offset;
  await db.query('UPDATE clinics SET timezone=$2 WHERE id=$1', [clinic.clinicId, tz]);
  const scheduled = {
    ...spec,
    trigger: { type: 'schedule', every: 'day', at: '12:00' },
    audience: { hasUpcomingAppointment: true },
  };
  const id = (
    await request('POST', '/staff/agents', { name: 'Scoped scheduled reminder', spec: scheduled })
  ).json().agentId;
  expect((await request('POST', `/staff/agents/${id}/activate`, {})).statusCode).toBe(200);
  await db.query("UPDATE custom_agents SET next_run_at=now()-interval '1 minute' WHERE id=$1", [
    id,
  ]);
  await callTool(
    rt,
    { clinicId: clinic.clinicId, actor: { kind: 'system' } },
    'run_custom_agents',
    {},
  );
  const sent = (await db.query('SELECT patient_id FROM custom_agent_sends WHERE agent_id=$1', [id]))
    .rows;
  expect(sent).toEqual([{ patient_id: patient1 }]);
  expect(
    (await db.query('SELECT id FROM custom_agent_sends WHERE patient_id=$1', [patient2])).rowCount,
  ).toBe(0);
});
it('routes events only to their doctor and revocation cancels pending work without affecting another doctor', async () => {
  await withClinic(pool, clinic.clinicId, async (c) => {
    await enqueueAgentEvents(c, clinic.clinicId, 'visit.finished', {
      patientId: patient2,
      doctorId: clinic.doctorIds[1],
    });
  });
  expect(
    (await db.query('SELECT * FROM agent_runs WHERE agent_id=$1', [personalId])).rowCount,
  ).toBe(0);
  await withClinic(pool, clinic.clinicId, (c) =>
    enqueueAgentEvents(c, clinic.clinicId, 'visit.finished', {
      patientId: patient1,
      doctorId: clinic.doctorIds[0],
    }),
  );
  expect(
    (
      await db.query("SELECT * FROM agent_runs WHERE agent_id=$1 AND status='pending'", [
        personalId,
      ])
    ).rowCount,
  ).toBe(1);
  await grant('reminders', false);
  expect(
    (await db.query('SELECT status FROM custom_agents WHERE id=$1', [personalId])).rows[0].status,
  ).toBe('paused');
  expect(
    (
      await db.query("SELECT * FROM agent_runs WHERE agent_id=$1 AND status='pending'", [
        personalId,
      ])
    ).rowCount,
  ).toBe(0);
  expect((await enable('reminders')).statusCode).toBe(403);
  expect((await request('POST', '/staff/agents/preview', { spec })).statusCode).toBe(403);
  const second = (await request('GET', '/staff/agents/access', undefined, 'second')).json();
  expect(second.doctors[0].assistants.find((a: any) => a.kind === 'reminders').allowed).toBe(true);
});
it('checks permissions again at execution, including already queued runs', async () => {
  // Deliberately emulate a stale active job after revocation; execution must fail closed.
  await db.query("UPDATE custom_agents SET status='active' WHERE id=$1", [personalId]);
  await db.query('INSERT INTO agent_runs(clinic_id,agent_id,patient_id) VALUES($1,$2,$3)', [
    clinic.clinicId,
    personalId,
    patient1,
  ]);
  const outcome = await callTool(
    rt,
    { clinicId: clinic.clinicId, actor: { kind: 'system' } },
    'run_custom_agents',
    {},
  );
  expect(outcome.skipped).toBeGreaterThan(0);
  expect(
    (await db.query('SELECT * FROM custom_agent_sends WHERE agent_id=$1', [personalId])).rowCount,
  ).toBe(0);
});
it('pauses only the selected doctor’s WhatsApp and phone assistant; safety still runs', async () => {
  await grant('whatsapp');
  await grant('phone');
  const defaults = await withClinic(pool, clinic.clinicId, async (c) => [
    await doctorAssistantEnabled(c, clinic.doctorIds[0], 'whatsapp'),
    await doctorAssistantEnabled(c, clinic.doctorIds[1], 'whatsapp'),
  ]);
  expect(defaults).toEqual([false, true]);
  const paused = await handleInbound(env, {
    clinicId: clinic.clinicId,
    from: '+919800003003',
    doctorId: clinic.doctorIds[0],
    text: 'Book appointment',
  });
  expect(paused.handledBy).toBe('human');
  expect(paused.replies.join(' ')).toMatch(/reception|team|person/i);
  const emergency = await handleInbound(env, {
    clinicId: clinic.clinicId,
    from: '+919800003004',
    doctorId: clinic.doctorIds[0],
    text: 'I have chest pain',
  });
  expect(emergency.redFlag).toBe(true);
  await enable('whatsapp');
  const enabled = await withClinic(pool, clinic.clinicId, (c) =>
    doctorAssistantEnabled(c, clinic.doctorIds[0], 'whatsapp'),
  );
  expect(enabled).toBe(true);
  const callId = randomUUID(),
    agentId = randomUUID();
  const c = await callTool(
    rt,
    { clinicId: clinic.clinicId, actor: { kind: 'system' } },
    'receive_call_message',
    { callId, agentId, text: 'hello', language: 'en' },
  );
  await db.query('UPDATE conversations SET state=$2 WHERE id=$1', [
    c.conversationId,
    JSON.stringify({ flow: 'ask_pref', doctorId: clinic.doctorIds[0] }),
  ]);
  const phone = await handleCallTurn(env, {
    clinicId: clinic.clinicId,
    callId,
    agentId,
    caller: '+919800003005',
    text: 'tomorrow morning',
    language: 'en',
  });
  expect(phone.action).toBe('handoff');
});
