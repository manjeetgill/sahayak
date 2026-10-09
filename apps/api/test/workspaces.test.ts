import { beforeAll, afterAll, it, expect } from 'vitest';
import pg from 'pg';
import { createTestClinic, dropTestClinic, hashPassword, makePool, addPatient } from '@sahayak/db';
import { EventBus, callTool, registerAllTools } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';
const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL }),
  pool = makePool(),
  bus = new EventBus('');
let clinic: Awaited<ReturnType<typeof createTestClinic>>,
  other: typeof clinic,
  app: Awaited<ReturnType<typeof buildApp>>;
const tokens: Record<string, string> = {},
  ids: Record<string, string> = {};
const request = (role: string, method: any, url: string, payload?: any) =>
  app.inject({ method, url, payload, headers: { authorization: `Bearer ${tokens[role]}` } });
beforeAll(async () => {
  await db.connect();
  clinic = await createTestClinic(db, 'roles');
  other = await createTestClinic(db, 'roles-other');
  registerAllTools();
  const hash = await hashPassword('roles-test-password');
  for (const role of ['admin', 'doctor', 'receptionist'])
    ids[role] = (
      await db.query(
        'INSERT INTO staff_users(clinic_id,email,password_hash,name,role,doctor_id) VALUES($1,$2,$3,$4,$4,$5) RETURNING id',
        [
          clinic.clinicId,
          `${role}-${clinic.slug}@test.invalid`,
          hash,
          role,
          role === 'doctor' ? clinic.doctorIds[0] : null,
        ],
      )
    ).rows[0].id;
  app = await buildApp({ pool, bus, gate: new LlmGate(null), jwtSecret: 'roles-test-secret' });
  for (const role of Object.keys(ids)) {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: `${role}-${clinic.slug}@test.invalid`, password: 'roles-test-password' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.role).toBe(role);
    tokens[role] = response.json().token;
  }
});
afterAll(async () => {
  await app.close();
  await dropTestClinic(db, clinic.clinicId);
  await dropTestClinic(db, other.clinicId);
  await db.end();
  await pool.end();
});
it('admin can open setup and review care screens while patient-care writes stay restricted', async () => {
  for (const url of [
    '/me',
    '/staff/setup',
    '/staff/team',
    '/staff/settings',
    '/staff/integrations',
    '/staff/agents',
  ])
    expect((await request('admin', 'GET', url)).statusCode, url).toBe(200);
  for (const url of [
    '/staff/patients?phone=%2B919899998888',
    '/staff/feedback',
    '/staff/inbox',
    '/staff/audit',
    '/staff/feedback/report',
    '/staff/queue',
    '/staff/today',
    '/staff/flags',
    '/staff/conversations',
    '/staff/care-tasks',
    '/staff/waitlist',
    '/staff/qr-arrivals',
    '/staff/practice',
    '/staff/schedule/summary',
    '/staff/references',
    '/staff/patient-checkins',
    '/staff/patient-checkins/preferences/all',
    '/staff/safety-report',
  ])
    expect((await request('admin', 'GET', url)).statusCode, url).toBe(200);
  for (const url of [
    '/staff/checkin',
    '/staff/queue/call-next',
    '/staff/notes/draft',
    '/staff/feedback/improvements',
    '/staff/workbench/instructions',
  ])
    expect((await request('admin', 'POST', url, {})).statusCode, url).toBe(403);
  for (const url of ['/staff/workbench/template-list', '/staff/workbench/daily-brief'])
    expect((await request('admin', 'POST', url, {})).statusCode, url).toBe(200);
});
it('care staff cannot configure connections, create logins or change clinic settings', async () => {
  for (const role of ['doctor', 'receptionist']) {
    for (const url of [
      '/staff/integrations',
      '/staff/agents/connections',
      '/staff/feedback/messaging',
    ])
      expect((await request(role, 'GET', url)).statusCode).toBe(403);
    expect((await request(role, 'POST', '/staff/team', {})).statusCode).toBe(403);
    expect((await request(role, 'PUT', '/staff/settings', { address: 'Changed' })).statusCode).toBe(
      403,
    );
    expect((await request(role, 'GET', '/staff/feedback')).statusCode).toBe(200);
  }
});
it('single-doctor view lets a doctor check in only to their own queue', async () => {
  const checkin = (doctorId: string, phone: string) =>
    request('doctor', 'POST', '/staff/checkin', {
      name: 'Synthetic Walk-in',
      phone,
      doctorId,
      consent: { visit_data: true, whatsapp_messaging: false, reminders_followups: false },
    });
  expect((await request('doctor', 'GET', '/staff/settings')).json().workspaceMode).toBe('full');
  expect((await checkin(clinic.doctorIds[0], '+919900001111')).statusCode).toBe(403);
  expect((await request('admin', 'PUT', '/staff/settings', { workspaceMode: 'solo' })).statusCode).toBe(200);
  expect((await request('doctor', 'GET', '/staff/settings')).json().workspaceMode).toBe('solo');
  expect(
    (await request('admin', 'GET', '/staff/setup')).json().items.find((item: any) => item.id === 'receptionist').required,
  ).toBe(false);
  expect((await checkin(clinic.doctorIds[1], '+919900001112')).statusCode).toBe(403);
  const added = await checkin(clinic.doctorIds[0], '+919900001113');
  expect(added.statusCode).toBe(200);
  expect(added.json().token).toBeGreaterThan(0);
  expect((await request('admin', 'PUT', '/staff/settings', { workspaceMode: 'full' })).statusCode).toBe(200);
  expect(
    (await request('admin', 'GET', '/staff/setup')).json().items.find((item: any) => item.id === 'receptionist').required,
  ).toBe(true);
  expect((await checkin(clinic.doctorIds[0], '+919900001114')).statusCode).toBe(403);
});
it('a selected doctor keeps clinical identity while managing solo clinic setup', async () => {
  expect((await request('doctor', 'GET', '/staff/integrations')).statusCode).toBe(403);
  expect((await request('doctor', 'GET', '/staff/conversations')).statusCode).toBe(403);
  expect((await request('admin', 'PUT', '/staff/settings', { workspaceMode: 'solo' })).statusCode).toBe(200);
  expect(
    (await request('admin', 'PUT', '/staff/team/solo-owner', { userId: ids.doctor })).statusCode,
  ).toBe(200);
  expect((await request('doctor', 'GET', '/me')).json().clinicAdmin).toBe(true);
  expect((await request('doctor', 'GET', '/staff/integrations')).statusCode).toBe(200);
  expect((await request('doctor', 'GET', '/staff/conversations')).statusCode).toBe(200);
  expect(
    (await request('doctor', 'PUT', '/staff/agents/preferences', { kind: 'reminders', enabled: false })).statusCode,
  ).toBe(200);
  expect((await request('doctor', 'GET', '/staff/team')).statusCode).toBe(200);
  expect(
    (await request('doctor', 'PUT', '/staff/settings', { workspaceMode: 'solo' })).statusCode,
  ).toBe(200);
  expect((await request('doctor', 'GET', '/staff/patient-checkins')).statusCode).toBe(200);
  expect((await request('doctor', 'GET', '/staff/queue')).statusCode).toBe(200);
  await db.query('UPDATE staff_users SET solo_owner=false WHERE id=$1', [ids.doctor]);
  expect((await request('doctor', 'GET', '/me')).json().clinicAdmin).toBe(false);
  expect((await request('doctor', 'GET', '/staff/integrations')).statusCode).toBe(403);
  expect((await request('doctor', 'GET', '/staff/conversations')).statusCode).toBe(403);
  expect((await request('admin', 'PUT', '/staff/settings', { workspaceMode: 'full' })).statusCode).toBe(200);
});
it('admin creates all role types and refuses linking a doctor from another clinic', async () => {
  for (const role of ['admin', 'doctor', 'receptionist']) {
    const res = await request('admin', 'POST', '/staff/team', {
      name: `New ${role}`,
      email: `new-${role}-${clinic.slug}@test.invalid`,
      password: 'private-test-password',
      role,
      doctorId: role === 'doctor' ? clinic.doctorIds[1] : undefined,
    });
    expect(res.statusCode, res.body).toBe(200);
  }
  expect(
    (
      await request('admin', 'POST', '/staff/team', {
        name: 'Wrong clinic',
        email: `wrong-${clinic.slug}@test.invalid`,
        password: 'private-test-password',
        role: 'doctor',
        doctorId: other.doctorIds[0],
      })
    ).statusCode,
  ).toBe(400);
  const audit = await db.query(
    "SELECT input FROM agent_actions WHERE clinic_id=$1 AND tool='add_staff'",
    [clinic.clinicId],
  );
  expect(JSON.stringify(audit.rows)).not.toContain('private-test-password');
});
it('doctors edit only their own professional details and admin cannot impersonate a signer', async () => {
  expect(
    (
      await request('doctor', 'PATCH', `/staff/doctors/${clinic.doctorIds[0]}`, {
        registrationNo: 'DEMO-123',
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await request('doctor', 'PATCH', `/staff/doctors/${clinic.doctorIds[1]}`, {
        registrationNo: 'DEMO-456',
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await request('doctor', 'PATCH', `/staff/doctors/${clinic.doctorIds[0]}`, { active: false }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await request('admin', 'PATCH', `/staff/doctors/${clinic.doctorIds[0]}`, {
        registrationNo: 'DEMO-456',
      })
    ).statusCode,
  ).toBe(403);
});
it('tool permissions also reject bypassing the HTTP role checks', async () => {
  await expect(
    callTool(
      { pool, bus },
      { clinicId: clinic.clinicId, actor: { kind: 'staff', role: 'doctor', userId: ids.doctor } },
      'add_staff',
      {
        name: 'Injected admin',
        email: 'injected@test.invalid',
        role: 'admin',
        password: 'long-password-123',
      },
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    callTool(
      { pool, bus },
      { clinicId: clinic.clinicId, actor: { kind: 'staff', role: 'admin', userId: ids.admin } },
      'update_feedback_case',
      {},
    ),
  ).rejects.toMatchObject({ status: 403 });
});

it('removing an account invalidates its existing token and cannot remove the signed-in admin', async () => {
  expect((await request('admin', 'DELETE', `/staff/team/${ids.admin}`)).json().error).toBe('self');
  const created = await request('admin', 'POST', '/staff/team', {
    name: 'Temporary admin',
    email: `temporary-${clinic.slug}@test.invalid`,
    role: 'admin',
    password: 'temporary-password-123',
  });
  expect(created.statusCode).toBe(200);
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: `temporary-${clinic.slug}@test.invalid`, password: 'temporary-password-123' },
  });
  expect(login.statusCode).toBe(200);
  expect((await request('admin', 'DELETE', `/staff/team/${created.json().id}`)).statusCode).toBe(
    200,
  );
  expect(
    (
      await app.inject({
        url: '/staff/setup',
        headers: { authorization: `Bearer ${login.json().token}` },
      })
    ).statusCode,
  ).toBe(401);
});

it('keeps automatic scheduling preferences with the doctor and delivery approval with admin', async () => {
  const url = '/staff/patient-checkins/preferences';
  const settings = {
    enabled: true,
    delayDays: 1,
    sendTime: '18:00',
    assignedTo: null,
    reminder: false,
  };
  for (const role of ['admin', 'receptionist']) {
    expect((await request(role, 'GET', url)).statusCode).toBe(403);
    expect((await request(role, 'PUT', url, settings)).statusCode).toBe(403);
  }
  expect((await request('doctor', 'PUT', url, settings)).statusCode).toBe(200);
  expect((await request('doctor', 'GET', url)).json()).toMatchObject({
    ...settings,
    deliveryEnabled: false,
  });
  expect(
    (await request('doctor', 'PUT', url, { ...settings, doctorId: other.doctorIds[0] })).statusCode,
  ).toBe(400);
  expect(
    (await request('doctor', 'PUT', '/staff/feedback/messaging', { enabled: true, reviewed: true }))
      .statusCode,
  ).toBe(403);
});

it('Admin review is clinic-scoped and cannot sign a note or confirm a payment', async () => {
  const own = await addPatient(db, clinic.clinicId, 'Admin review patient', '+919880001111');
  const foreign = await addPatient(db, other.clinicId, 'Other clinic patient', '+919880002222');
  for (const suffix of ['record', 'workspace', 'brief']) {
    expect((await request('admin', 'GET', `/staff/patients/${own}/${suffix}`)).statusCode).toBe(
      200,
    );
    expect((await request('admin', 'GET', `/staff/patients/${foreign}/${suffix}`)).statusCode).toBe(
      404,
    );
  }
  const patients = await request('admin', 'GET', '/staff/patients/search?q=patient');
  expect(patients.statusCode).toBe(200);
  expect(patients.body).toContain('Admin review patient');
  expect(patients.body).not.toContain('Other clinic patient');
  expect((await request('admin', 'POST', `/staff/notes/${own}/sign`, {})).statusCode).toBe(403);
  expect((await request('admin', 'POST', `/staff/qr-arrivals/${own}/confirm`, {})).statusCode).toBe(
    403,
  );
  expect(
    (await request('admin', 'PUT', '/staff/patient-checkins/preferences', {})).statusCode,
  ).toBe(403);
  expect(
    (await request('doctor', 'GET', '/staff/patient-checkins/preferences/all')).statusCode,
  ).toBe(403);
  expect(
    (await request('admin', 'POST', '/staff/workbench/record-search', { patientId: own }))
      .statusCode,
  ).toBe(200);
  expect(
    (await request('admin', 'POST', '/staff/workbench/record-search', { patientId: foreign }))
      .statusCode,
  ).toBe(404);
});
