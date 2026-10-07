import { beforeAll, afterAll, it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { addPatient, createTestClinic, dropTestClinic, makePool } from '@sahayak/db';
import { EventBus, callTool, registerAllTools, type ToolContext } from '@sahayak/core';
import { LlmGate, analysePatientFeedback, handleInbound } from '@sahayak/agents';
import { buildApp } from '../src/app';
const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool(),
  bus = new EventBus(''),
  rt = { pool, bus };
let clinic: Awaited<ReturnType<typeof createTestClinic>>,
  other: typeof clinic,
  app: Awaited<ReturnType<typeof buildApp>>,
  ctx: ToolContext,
  owner: string,
  patient: string,
  visit: string,
  checkin: string,
  link: string;
let setupAuth: Record<string, string>;
let auth: Record<string, string>, reception: Record<string, string>;
const channel = randomUUID(),
  providerId = randomUUID();
let templateChanged = false;
let approvals = 0,
  prepared = 0,
  delivered = false,
  readReceipt = false;
const savedOrigin = process.env.CHECKIN_PUBLIC_WEB_URL;
const call = (name: string, input: unknown) => callTool(rt, ctx, name, input);
const api = async (method: any, url: string, body?: unknown, headers = auth) =>
  app.inject({ method, url, headers, payload: body as any });
const publicApi = (kind: string, body: unknown, slug = clinic.slug) =>
  api('POST', `/public/${slug}/feedback/${kind}`, body, {});
const token = (path: string) => path.split('#')[1];
beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  clinic = await createTestClinic(admin, 'feedback');
  other = await createTestClinic(admin, 'other-feedback');
  await admin.query(
    "UPDATE clinics SET timezone=(SELECT name FROM pg_timezone_names WHERE to_char(now() AT TIME ZONE name,'HH24')='12' LIMIT 1) WHERE id=$1",
    [clinic.clinicId],
  );
  owner = (
    await admin.query(
      "INSERT INTO staff_users(clinic_id,email,password_hash,name,role,doctor_id) VALUES($1,$2,'unused','Feedback doctor','doctor',$3) RETURNING id",
      [clinic.clinicId, `${clinic.slug}@test.invalid`, clinic.doctorIds[0]],
    )
  ).rows[0].id;
  ctx = {
    clinicId: clinic.clinicId,
    actor: { kind: 'staff', role: 'doctor', userId: owner, doctorId: clinic.doctorIds[0] },
  };
  const receptionUser = (
    await admin.query(
      "INSERT INTO staff_users(clinic_id,email,password_hash,name,role) VALUES($1,$2,'unused','Reception test','receptionist') RETURNING id",
      [clinic.clinicId, `rec-${clinic.slug}@test.invalid`],
    )
  ).rows[0].id;
  const setupUser = (
    await admin.query(
      "INSERT INTO staff_users(clinic_id,email,password_hash,name,role) VALUES($1,$2,'unused','Clinic admin','admin') RETURNING id",
      [clinic.clinicId, `admin-${clinic.slug}@test.invalid`],
    )
  ).rows[0].id;
  patient = await addPatient(admin, clinic.clinicId, 'Feedback patient', '+919533331110');
  visit = (
    await admin.query(
      "INSERT INTO queue_entries(clinic_id,patient_id,doctor_id,queue_date,token_number,position_key,status) VALUES($1,$2,$3,current_date,8001,8001,'in_consultation') RETURNING id",
      [clinic.clinicId, patient, clinic.doctorIds[0]],
    )
  ).rows[0].id;
  process.env.CHECKIN_PUBLIC_WEB_URL = 'https://clinic.example.test';
  app = await buildApp({
    pool,
    bus,
    gate: new LlmGate(null),
    jwtSecret: 'feedback-test-secret',
    whatsappBridge: {
      [channel]: { clinicId: clinic.clinicId, appId: randomUUID(), secret: 'a'.repeat(64) },
    },
    whatsappPlatform: {
      baseUrl: 'https://platform.example.test',
      clinics: { [clinic.clinicId]: { key: 'test-key-12345', externalUserId: 'clinic-owner' } },
      fetchImpl: async (input: any, init: any) => {
        const url = String(input);
        if (url.endsWith('send-setup'))
          return new Response(
            JSON.stringify({
              webhook_verified: true,
              templates: [
                {
                  id: '123456',
                  name: 'patient_checkin',
                  language: 'en',
                  text: templateChanged
                    ? 'Changed invitation. Reply FEEDBACK.'
                    : 'The clinic is checking on you. Reply FEEDBACK to get your private form.',
                },
              ],
            }),
          );
        if (url.endsWith('/approve')) {
          approvals++;
          return new Response(JSON.stringify({ id: providerId, status: 'QUEUED' }));
        }
        if (init?.method === 'POST') {
          prepared++;
          return new Response(JSON.stringify({ id: providerId, status: 'DRAFT' }));
        }
        return new Response(
          JSON.stringify([
            {
              id: providerId,
              status: delivered ? 'ACCEPTED' : 'QUEUED',
              delivery: readReceipt ? 'read' : delivered ? 'delivered' : null,
              idempotency_key: 'sahayak-checkin-' + checkin + '-initial',
            },
          ]),
        );
      },
    },
  });
  auth = {
    authorization: `Bearer ${app.jwt.sign({ uid: owner, clinicId: clinic.clinicId, role: 'doctor', doctorId: clinic.doctorIds[0], name: 'Feedback doctor' })}`,
  };
  reception = {
    authorization: `Bearer ${app.jwt.sign({ uid: receptionUser, clinicId: clinic.clinicId, role: 'receptionist', name: 'Reception test' })}`,
  };
  setupAuth = {
    authorization: `Bearer ${app.jwt.sign({ uid: setupUser, clinicId: clinic.clinicId, role: 'admin', doctorId: null, name: 'Clinic admin' })}`,
  };
  checkin = (
    await call('schedule_patient_checkin', {
      patientId: patient,
      queueEntryId: visit,
      assignedTo: owner,
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      language: 'en',
      consent: true,
      reminder: true,
    })
  ).checkinId;
  link = token((await call('prepare_feedback_link', { id: checkin, purpose: 'response' })).path);
});
afterAll(async () => {
  if (savedOrigin === undefined) delete process.env.CHECKIN_PUBLIC_WEB_URL;
  else process.env.CHECKIN_PUBLIC_WEB_URL = savedOrigin;
  await app.close();
  await dropTestClinic(admin, clinic.clinicId);
  await dropTestClinic(admin, other.clinicId);
  await admin.end();
  await pool.end();
});
it('limits private links to the right clinic and hides patient details', async () => {
  const r = await publicApi('open', { token: link });
  expect(r.statusCode).toBe(200);
  expect(r.json().clinic).toBe(clinic.slug.startsWith('feedback') ? `Clinic ${clinic.slug}` : '');
  expect(r.body).not.toContain('Feedback patient');
  expect(r.headers['cache-control']).toBe('no-store');
  expect((await publicApi('open', { token: link }, other.slug)).statusCode).toBe(410);
  expect((await publicApi('open', { token: 'a'.repeat(64) })).statusCode).toBe(410);
  expect((await api('GET', '/staff/feedback', undefined, {})).statusCode).toBe(401);
});
it('requires reviewed setup, queues one idempotent invitation and confirms delivery separately', async () => {
  expect(
    (
      await api(
        'PUT',
        '/staff/feedback/messaging',
        { enabled: true, templateId: '123456', reviewed: true },
        reception,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await api(
        'PUT',
        '/staff/feedback/messaging',
        {
          enabled: true,
          templateId: '999999',
          reviewed: true,
        },
        setupAuth,
      )
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await api(
        'PUT',
        '/staff/feedback/messaging',
        {
          enabled: true,
          templateId: '123456',
          reviewed: true,
        },
        setupAuth,
      )
    ).statusCode,
  ).toBe(200);
  await admin.query(
    "UPDATE patient_checkins SET scheduled_at=now()-interval '1 hour' WHERE id=$1",
    [checkin],
  );
  expect(
    (
      await api('POST', `/staff/feedback/${checkin}/send`, { kind: 'initial', approved: true })
    ).json().state,
  ).toBe('queued');
  await api('POST', `/staff/feedback/${checkin}/send`, { kind: 'initial', approved: true });
  expect(prepared).toBe(1);
  expect(approvals).toBe(1);
  let work = (await api('GET', '/staff/feedback')).json();
  expect(work.cases[0].delivery[0].delivered_at).toBe(null);
  expect(
    (await api('GET', '/staff/feedback/delivery-evidence', undefined, setupAuth)).json().summary
      .delivered,
  ).toBe(0);
  expect((await api('GET', '/staff/feedback/delivery-evidence')).statusCode).toBe(403);
  await admin.query(
    "UPDATE patient_feedback_delivery SET provider_id=NULL,state='unknown' WHERE checkin_id=$1",
    [checkin],
  );
  delivered = true;
  await api('POST', '/staff/feedback/delivery-refresh', {}, setupAuth);
  work = (await api('GET', '/staff/feedback')).json();
  expect(work.cases[0].delivery[0].delivered_at).toBeTruthy();
  expect(work.cases[0].delivery[0].provider_id).toBe(providerId);
  expect(
    (await api('GET', '/staff/feedback/delivery-evidence', undefined, setupAuth)).json().summary
      .delivered,
  ).toBe(1);
  readReceipt = true;
  await api('POST', '/staff/feedback/delivery-refresh', {}, setupAuth);
  expect(
    (await api('GET', '/staff/feedback/delivery-evidence', undefined, setupAuth)).json().summary
      .read,
  ).toBe(1);
  readReceipt = false;
  delivered = false;
  await api('POST', '/staff/feedback/delivery-refresh', {}, setupAuth);
  expect(
    (await api('GET', '/staff/feedback/delivery-evidence', undefined, setupAuth)).json().summary
      .read,
  ).toBe(1);
  delivered = true;
  await api('POST', `/staff/feedback/${checkin}/send`, { kind: 'reminder', approved: true });
  expect(prepared).toBe(1);
});
it('saves an urgent response exactly once and surfaces it in the doctor inbox', async () => {
  const body = {
    token: link,
    recovery: 'worse',
    help: 'medicine',
    theme: 'explanation',
    message: 'I have chest pain. The instructions were unclear.',
  };
  const replies = await Promise.all([publicApi('response', body), publicApi('response', body)]);
  expect(replies.every((r) => r.statusCode === 200)).toBe(true);
  expect(
    (
      await admin.query(
        'SELECT count(*)::int n FROM patient_feedback_responses WHERE checkin_id=$1',
        [checkin],
      )
    ).rows[0].n,
  ).toBe(1);
  const inbox = await call('get_doctor_inbox', { category: 'checkin' });
  expect(inbox.items.some((i: any) => i.key === `checkin:${checkin}` && i.priority === 0)).toBe(
    true,
  );
  const audits = (
    await admin.query(
      "SELECT input,output FROM agent_actions WHERE clinic_id=$1 AND tool='submit_patient_feedback'",
      [clinic.clinicId],
    )
  ).rows;
  expect(JSON.stringify(audits)).not.toContain('chest pain');
  expect((await api('POST', `/staff/feedback/${checkin}/analyse`, {})).json().usedAi).toBe(false);
});
it('enforces ordered clinical review and reopens unresolved patient confirmations', async () => {
  expect(
    (
      await api('PATCH', `/staff/feedback/${checkin}`, {
        action: 'close',
        note: 'Close without review',
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await api(
        'PATCH',
        `/staff/feedback/${checkin}`,
        { action: 'contacted', note: 'Called the patient for this synthetic test' },
        reception,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await api(
        'PATCH',
        `/staff/feedback/${checkin}`,
        { action: 'action_taken', note: 'Reception cannot approve clinical action' },
        reception,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await api('PATCH', `/staff/feedback/${checkin}`, {
        action: 'action_taken',
        note: 'Doctor reviewed the concern in this test',
      })
    ).statusCode,
  ).toBe(200);
  let response = (
    await api('POST', `/staff/feedback/${checkin}/link`, { purpose: 'resolution' })
  ).json();
  let t = token(response.path);
  expect((await publicApi('resolution', { token: t, answer: 'help' })).statusCode).toBe(200);
  expect((await api('GET', '/staff/feedback')).json().cases[0].work_status).toBe('new');
  await api('PATCH', `/staff/feedback/${checkin}`, {
    action: 'contacted',
    note: 'Contacted again for test',
  });
  await api('PATCH', `/staff/feedback/${checkin}`, {
    action: 'action_taken',
    note: 'Clarified approved instructions in test',
  });
  response = (
    await api('POST', `/staff/feedback/${checkin}/link`, { purpose: 'resolution' })
  ).json();
  t = token(response.path);
  await publicApi('resolution', { token: t, answer: 'yes' });
  expect((await api('GET', '/staff/feedback')).json().cases[0].work_status).toBe('closed');
  await publicApi('resolution', { token: t, answer: 'help' });
  expect((await api('GET', '/staff/feedback')).json().cases[0].work_status).toBe('closed');
});
it('reports source-linked themes and assigns a clinic improvement', async () => {
  const report = (await api('GET', '/staff/feedback/report')).json();
  expect(report.counts.responded).toBe(1);
  expect(report.themes[0].sources[0].id).toBe(checkin);
  expect(
    (
      await api('POST', '/staff/feedback/improvements', {
        title: 'Explain return visit instructions',
        sourceId: checkin,
        assignedTo: owner,
        dueAt: new Date(Date.now() + 86400000).toISOString(),
      })
    ).statusCode,
  ).toBe(200);
  const tasks = (await api('GET', '/staff/feedback/report')).json().improvements;
  expect(tasks).toHaveLength(1);
  expect((await api('GET', '/staff/feedback/report', undefined, reception)).statusCode).toBe(403);
});
it('keeps unresolved care visible after opt-out, revokes links and blocks further outreach', async () => {
  await api('PATCH', `/staff/feedback/${checkin}`, {
    action: 'reopen',
    note: 'Patient needs another review',
  });
  await api('PATCH', `/staff/feedback/${checkin}`, {
    action: 'contacted',
    note: 'Synthetic follow-up contact',
  });
  await api('PATCH', `/staff/feedback/${checkin}`, {
    action: 'action_taken',
    note: 'Doctor action for opt-out test',
  });
  const path = (
    await api('POST', `/staff/feedback/${checkin}/link`, { purpose: 'resolution' })
  ).json().path;
  expect((await publicApi('stop', { token: token(path) })).statusCode).toBe(200);
  expect((await publicApi('open', { token: token(path) })).statusCode).toBe(410);
  expect((await api('GET', '/staff/feedback')).json().cases[0].work_status).toBe('action_taken');
  const before = approvals;
  await api('POST', `/staff/feedback/${checkin}/send`, { kind: 'reminder', approved: true });
  expect(approvals).toBe(before);
  expect(
    (await api('POST', `/staff/feedback/${checkin}/link`, { purpose: 'resolution' })).statusCode,
  ).toBe(400);
});
it('rejects invented AI excerpts and safely handles unavailable models', async () => {
  const source = 'Mujhe instructions samajh nahi aaye';
  const bad = new LlmGate({
    name: 'test',
    chat: async () => ({
      content: JSON.stringify({
        category: 'clinical',
        quotes: ['Invented symptoms'],
        uncertain: false,
      }),
      toolCalls: [],
    }),
  });
  expect((await analysePatientFeedback(bad, source)).usedAi).toBe(false);
  const good = new LlmGate({
    name: 'test',
    chat: async () => ({
      content: JSON.stringify({ category: 'instructions', quotes: [source], uncertain: true }),
      toolCalls: [],
    }),
  });
  const result = await analysePatientFeedback(good, source);
  expect(result.usedAi).toBe(true);
  expect(result.quotes).toEqual([source]);
});
it('routes FEEDBACK from a known WhatsApp patient to their own form and expires links', async () => {
  const phone = '+919533331115';
  const p = await addPatient(admin, clinic.clinicId, 'Invitation test', phone);
  const v = (
    await admin.query(
      "INSERT INTO queue_entries(clinic_id,patient_id,doctor_id,queue_date,token_number,position_key,status) VALUES($1,$2,$3,current_date,8002,8002,'done') RETURNING id",
      [clinic.clinicId, p, clinic.doctorIds[0]],
    )
  ).rows[0].id;
  const c = await call('schedule_patient_checkin', {
    patientId: p,
    queueEntryId: v,
    assignedTo: owner,
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    language: 'en',
    consent: true,
  });
  const result = await handleInbound(
    { rt, gate: new LlmGate(null) },
    { clinicId: clinic.clinicId, from: phone, text: 'FEEDBACK', channel: 'whatsapp' },
  );
  expect(result.replies.join(' ')).toContain('https://clinic.example.test/c/');
  const t = result.replies.join(' ').match(/#([a-f0-9]{64})/)![1];
  expect((await publicApi('open', { token: t })).statusCode).toBe(200);
  await admin.query(
    "UPDATE patient_feedback_links SET expires_at=now()-interval '1 second' WHERE checkin_id=$1",
    [c.checkinId],
  );
  expect(
    (
      await publicApi('response', {
        token: t,
        recovery: 'better',
        help: 'none',
        theme: 'none',
        message: '',
      })
    ).statusCode,
  ).toBe(410);
});
it('erasure removes feedback text and links and redacts linked improvement titles', async () => {
  const exported = await call('export_patient_data', { patientId: patient });
  expect(exported.patientFeedback).toHaveLength(1);
  expect(exported.patientFeedbackHistory.length).toBeGreaterThan(0);
  await call('erase_patient_data', { patientId: patient });
  expect(
    (await admin.query('SELECT 1 FROM patient_checkins WHERE id=$1', [checkin])).rowCount,
  ).toBe(0);
  expect(
    (await admin.query('SELECT 1 FROM patient_feedback_responses WHERE checkin_id=$1', [checkin]))
      .rowCount,
  ).toBe(0);
  expect(
    (await admin.query('SELECT 1 FROM patient_feedback_links WHERE checkin_id=$1', [checkin]))
      .rowCount,
  ).toBe(0);
  const task = (
    await admin.query(
      'SELECT title,source_checkin_id FROM patient_feedback_improvements WHERE clinic_id=$1',
      [clinic.clinicId],
    )
  ).rows[0];
  expect(task.title).toContain('patient details removed');
  expect(task.source_checkin_id).toBe(null);
});

it('blocks changed invitation text and retries only after the reviewed content is restored', async () => {
  const pending = (
    await admin.query(
      "SELECT c.id FROM patient_checkins c JOIN patients p ON p.id=c.patient_id WHERE c.clinic_id=$1 AND p.phone='+919533331115'",
      [clinic.clinicId],
    )
  ).rows[0];
  await admin.query(
    "UPDATE patient_checkins SET scheduled_at=now()-interval '1 hour' WHERE id=$1",
    [pending.id],
  );
  const before = approvals;
  templateChanged = true;
  const blocked = await api('POST', `/staff/feedback/${pending.id}/send`, {
    kind: 'initial',
    approved: true,
  });
  expect(blocked.json().state).toBe('blocked');
  expect(approvals).toBe(before);
  templateChanged = false;
  expect(
    (
      await api('POST', `/staff/feedback/${pending.id}/send`, { kind: 'initial', approved: true })
    ).json().state,
  ).toBe('queued');
  expect(approvals).toBe(before + 1);
});
