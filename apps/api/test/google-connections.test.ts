import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { makePool, withClinic, createTestClinic, dropTestClinic, addPatient } from '@sahayak/db';
import { EventBus } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';
import {
  decrypt,
  googleFromEnv,
  scopes,
  type GoogleKind,
  type GoogleOptions,
} from '../src/google-provider';
import { syncGoogleConnection, runGoogleSync } from '../src/google-sync';
const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL }),
  pool = makePool();
let clinic: Awaited<ReturnType<typeof createTestClinic>>, other: typeof clinic, patient: string;
let app: Awaited<ReturnType<typeof buildApp>>;
const users: Record<string, any> = {};
const requests: { url: string; method: string; body: any }[] = [];
const events = new Map<string, any>(),
  rows = new Map<string, any>();
let failToken = 0,
  loseEvent = false,
  loseSheet = false,
  loseDestination = false;
let grantedScope: string = scopes.calendar;
const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input),
    method = init?.method ?? 'GET';
  const body =
    typeof init?.body === 'string' && init.body.startsWith('{')
      ? JSON.parse(init.body)
      : init?.body;
  requests.push({ url, method, body });
  if (url.endsWith('/token'))
    return failToken
      ? json({}, failToken)
      : json({ access_token: 'test-access', refresh_token: 'test-refresh', scope: grantedScope });
  if (method === 'POST' && (url.endsWith('/calendars') || url.endsWith('/spreadsheets'))) {
    if (loseDestination) throw Error('lost response');
    return json({ id: 'clinic-calendar', spreadsheetId: 'clinic-sheet' });
  }
  if (url.includes('/events')) {
    const key = new URL(url).pathname;
    if (method === 'POST') {
      const eventKey = key + '/' + body.id;
      if (events.has(eventKey)) return json({}, 409);
      events.set(eventKey, body);
      if (loseEvent) {
        loseEvent = false;
        throw Error('lost response');
      }
      return json(body);
    }
    if (method === 'DELETE') {
      events.delete(key);
      return new Response(null, { status: 204 });
    }
    if (!events.has(key)) return json({}, 404);
    if (method === 'PATCH') events.set(key, { ...events.get(key), ...body });
    return json(events.get(key));
  }
  if (url.includes('/values/')) {
    const key = decodeURIComponent(new URL(url).pathname);
    if (method === 'PUT') {
      rows.set(key, body.values);
      if (loseSheet && !key.endsWith('A1:E1')) {
        loseSheet = false;
        throw Error('lost response');
      }
      return json({ updatedRows: 1 });
    }
    return json({ values: rows.get(key) ?? [] });
  }
  return json({ id: 'clinic-calendar', spreadsheetId: 'clinic-sheet' });
};
const options: GoogleOptions = {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  redirectUri: 'http://localhost:4000/integrations/google/callback',
  webUrl: 'http://localhost:3000',
  encryptionKey: randomBytes(32).toString('hex'),
  fetchImpl: fakeFetch,
};
const auth = (role = 'admin') => ({ authorization: 'Bearer ' + app.jwt.sign(users[role]) });
const req = (method: any, path: string, body?: any, role = 'admin') =>
  app.inject({
    method,
    url: '/staff/integrations/google' + path,
    headers: auth(role),
    ...(body === undefined ? {} : { payload: body }),
  });
const callback = (state: string) =>
  app.inject({
    url: '/integrations/google/callback?code=test-code&state=' + encodeURIComponent(state),
  });
async function authorize(kind: GoogleKind = 'calendar') {
  grantedScope = scopes[kind];
  const start = await req('POST', `/${kind}/start`, {});
  expect(start.statusCode).toBe(200);
  const { state, proof } = start.json();
  expect((await callback(state)).statusCode).toBe(302);
  expect((await req('POST', '/complete', { state, proof })).statusCode).toBe(200);
  return { state, proof };
}
async function ready(kind: GoogleKind = 'calendar') {
  await authorize(kind);
  expect((await req('POST', `/${kind}/prepare`, { acceptsExport: true })).statusCode).toBe(200);
  expect(
    (await req('PUT', `/${kind}/settings`, { enabled: true, acceptsExport: true })).statusCode,
  ).toBe(200);
  return (
    await db.query('SELECT id FROM google_connections WHERE clinic_id=$1 AND kind=$2', [
      clinic.clinicId,
      kind,
    ])
  ).rows[0].id as string;
}
async function book(offset = 2) {
  return withClinic(
    pool,
    clinic.clinicId,
    async (c) =>
      (
        await c.query(
          "INSERT INTO appointments(clinic_id,patient_id,doctor_id,starts_at,ends_at,status) VALUES($1,$2,$3,now()+make_interval(days=>$4::int),now()+make_interval(days=>$4::int)+interval '15 minutes','booked') RETURNING id",
          [clinic.clinicId, patient, clinic.doctorIds[0], offset],
        )
      ).rows[0].id as string,
  );
}
const pending = () =>
  db.query('UPDATE google_sync_items SET next_attempt_at=now() WHERE clinic_id=$1', [
    clinic.clinicId,
  ]);
beforeAll(async () => {
  await db.connect();
  clinic = await createTestClinic(db, 'google');
  other = await createTestClinic(db, 'googleother');
  patient = await addPatient(db, clinic.clinicId, 'Private Patient Name', '+919899997777');
  for (const role of ['admin', 'second', 'doctor', 'receptionist', 'other']) {
    const roleName = ['second', 'other'].includes(role) ? 'admin' : role,
      clinicId = role === 'other' ? other.clinicId : clinic.clinicId;
    const doctorId = role === 'doctor' ? clinic.doctorIds[0] : null;
    const u = (
      await db.query(
        "INSERT INTO staff_users(clinic_id,email,name,role,password_hash,doctor_id) VALUES($1,$2,$3,$4,'unused',$5) RETURNING id",
        [clinicId, role + clinic.slug + '@test.invalid', role, roleName, doctorId],
      )
    ).rows[0];
    users[role] = { uid: u.id, clinicId, role: roleName, doctorId, name: role };
  }
  app = await buildApp({
    pool,
    bus: new EventBus(''),
    gate: new LlmGate(null),
    jwtSecret: 'google-tests',
    google: options,
  });
});
beforeEach(async () => {
  await db.query('DELETE FROM google_connections WHERE clinic_id=$1', [clinic.clinicId]);
  await db.query('DELETE FROM google_oauth_requests WHERE clinic_id=$1', [clinic.clinicId]);
  await db.query('DELETE FROM appointments WHERE clinic_id=$1', [clinic.clinicId]);
  requests.length = 0;
  events.clear();
  rows.clear();
  failToken = 0;
  loseEvent = false;
  loseSheet = false;
  loseDestination = false;
  grantedScope = scopes.calendar;
});
afterAll(async () => {
  await app?.close();
  for (const c of [clinic, other]) if (c) await dropTestClinic(db, c.clinicId);
  await pool.end();
  await db.end();
});
it('requires Admin, scopes all data to the clinic, and reports absent setup honestly', async () => {
  for (const role of ['doctor', 'receptionist']) {
    expect((await req('GET', '', undefined, role)).statusCode).toBe(403);
    expect((await req('POST', '/calendar/start', {}, role)).statusCode).toBe(403);
  }
  expect((await app.inject({ url: '/staff/integrations/google' })).statusCode).toBe(401);
  const absent = await buildApp({
    pool,
    bus: new EventBus(''),
    gate: new LlmGate(null),
    jwtSecret: 'google-tests',
  });
  expect(
    (await absent.inject({ url: '/staff/integrations/google', headers: auth() })).json().configured,
  ).toBe(false);
  expect(
    (
      await absent.inject({
        method: 'POST',
        url: '/staff/integrations/google/calendar/start',
        headers: auth(),
        payload: {},
      })
    ).statusCode,
  ).toBe(409);
  await absent.close();
  await authorize();
  expect((await req('GET', '', undefined, 'other')).json().connections).toEqual([]);
  expect(googleFromEnv({})).toBeUndefined();
});
it('binds Google authorization to one Admin browser proof; rejects tampering, replay and other clinics', async () => {
  const start = (await req('POST', '/calendar/start', {})).json();
  const url = new URL(start.url);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('scope')).toBe(scopes.calendar);
  expect((await callback(start.state + 'x')).statusCode).toBe(400);
  expect((await callback(start.state)).statusCode).toBe(302);
  expect((await req('GET', '')).json().connections).toEqual([]);
  expect(
    (await req('POST', '/complete', { state: start.state, proof: '0'.repeat(64) })).statusCode,
  ).toBe(403);
  expect((await req('POST', '/complete', start, 'second')).statusCode).toBe(403);
  expect((await req('POST', '/complete', start, 'other')).statusCode).toBe(403);
  const calls = requests.length;
  expect((await callback(start.state)).statusCode).toBe(400);
  expect(requests).toHaveLength(calls);
  expect((await req('POST', '/complete', start)).statusCode).toBe(200);
  expect((await req('POST', '/complete', start)).statusCode).toBe(403);
  const c = (
    await db.query('SELECT refresh_token FROM google_connections WHERE clinic_id=$1', [
      clinic.clinicId,
    ])
  ).rows[0];
  expect(c.refresh_token).not.toContain('test-refresh');
  expect(decrypt(options, c.refresh_token, clinic.clinicId + ':calendar')).toBe('test-refresh');
  expect(() => decrypt(options, c.refresh_token, other.clinicId + ':calendar')).toThrow();
  const response = (await req('GET', '')).body;
  expect(response).not.toMatch(/test-refresh|refresh_token|proof|verifier|test-secret/);
});
it('rejects expired requests, removed Admin access and incomplete Google grants', async () => {
  let s = (await req('POST', '/calendar/start', {})).json();
  await db.query(
    "UPDATE google_oauth_requests SET expires_at=now()-interval '1 minute' WHERE clinic_id=$1",
    [clinic.clinicId],
  );
  expect((await callback(s.state)).statusCode).toBe(400);
  s = (await req('POST', '/calendar/start', {})).json();
  await db.query("UPDATE staff_users SET role='receptionist' WHERE id=$1", [users.admin.uid]);
  expect((await callback(s.state)).statusCode).toBe(400);
  await db.query("UPDATE staff_users SET role='admin' WHERE id=$1", [users.admin.uid]);
  s = (await req('POST', '/calendar/start', {})).json();
  grantedScope = 'unrelated';
  const cb = await callback(s.state);
  expect(cb.headers.location).toContain('google=failed');
  expect((await req('POST', '/complete', s)).statusCode).toBe(403);
});
it('requires sharing approval, creates a destination once, and never repeats uncertain creation', async () => {
  await authorize();
  expect((await req('POST', '/calendar/prepare', {})).statusCode).toBe(400);
  expect(
    (await req('PUT', '/calendar/settings', { enabled: true, acceptsExport: true })).statusCode,
  ).toBe(409);
  loseDestination = true;
  expect((await req('POST', '/calendar/prepare', { acceptsExport: true })).statusCode).toBe(409);
  loseDestination = false;
  expect((await req('POST', '/calendar/prepare', { acceptsExport: true })).statusCode).toBe(409);
  expect(requests.filter((x) => x.method === 'POST' && x.url.endsWith('/calendars'))).toHaveLength(
    1,
  );
  expect((await req('GET', '')).json().connections[0]).toMatchObject({
    setup_state: 'unknown',
    enabled: false,
  });
});
it('queues only committed clinic appointments; delivers calendar changes without duplicate events after a lost response', async () => {
  const id = await ready();
  const appointment = await book();
  await expect(
    withClinic(pool, clinic.clinicId, async (c) => {
      await c.query("UPDATE appointments SET status='cancelled' WHERE id=$1", [appointment]);
      throw Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(
    (await db.query('SELECT payload FROM google_sync_items WHERE connection_id=$1', [id])).rows[0]
      .payload.status,
  ).toBe('booked');
  loseEvent = true;
  expect((await syncGoogleConnection(pool, options, clinic.clinicId, id)).processed).toBe(0);
  expect(events.size).toBe(1);
  await pending();
  expect((await syncGoogleConnection(pool, options, clinic.clinicId, id)).processed).toBe(1);
  expect(events.size).toBe(1);
  await withClinic(pool, clinic.clinicId, (c) =>
    c.query(
      "UPDATE appointments SET status='needs_rebooking',starts_at=starts_at+interval '1 hour',ends_at=ends_at+interval '1 hour' WHERE id=$1",
      [appointment],
    ),
  );
  await runGoogleSync(pool, options);
  expect([...events.values()][0].description).toContain('needs_rebooking');
  await withClinic(pool, clinic.clinicId, (c) =>
    c.query("UPDATE appointments SET status='cancelled' WHERE id=$1", [appointment]),
  );
  await runGoogleSync(pool, options);
  expect(events.size).toBe(0);
  expect(JSON.stringify(requests)).not.toMatch(/Private Patient Name|919899997777/);
  expect((await syncGoogleConnection(pool, options, other.clinicId, id)).processed).toBe(0);
});
it('writes stable RAW spreadsheet rows and refuses to overwrite manually moved rows', async () => {
  const id = await ready('sheets'),
    appointment = await book();
  loseSheet = true;
  await syncGoogleConnection(pool, options, clinic.clinicId, id);
  await pending();
  await syncGoogleConnection(pool, options, clinic.clinicId, id);
  const writes = requests.filter((x) => x.method === 'PUT' && x.url.includes('A2%3AE2'));
  expect(writes).toHaveLength(2);
  expect(writes[0].url).toContain('valueInputOption=RAW');
  expect(writes[0].body.values[0]).toHaveLength(5);
  expect(rows.size).toBe(2);
  const rowKey = [...rows.keys()].find((k) => k.endsWith('A2:E2'))!;
  rows.set(rowKey, [['some-other-appointment']]);
  await withClinic(pool, clinic.clinicId, (c) =>
    c.query("UPDATE appointments SET status='checked_in' WHERE id=$1", [appointment]),
  );
  expect((await syncGoogleConnection(pool, options, clinic.clinicId, id)).processed).toBe(0);
  expect(rows.get(rowKey)).toEqual([['some-other-appointment']]);
  expect((await req('GET', '')).json().connections[0].counts.failed).toBe(1);
});
it('pauses delivery, catches up after resuming, retries transient failures, and disconnects locally', async () => {
  const id = await ready();
  await book();
  expect((await req('PUT', '/calendar/settings', { enabled: false })).statusCode).toBe(200);
  const calls = requests.length;
  await runGoogleSync(pool, options);
  expect(requests).toHaveLength(calls);
  expect((await req('PUT', '/calendar/settings', { enabled: true })).statusCode).toBe(400);
  expect(
    (await req('PUT', '/calendar/settings', { enabled: true, acceptsExport: true })).statusCode,
  ).toBe(200);
  failToken = 503;
  await syncGoogleConnection(pool, options, clinic.clinicId, id);
  expect((await req('GET', '')).json().connections[0].enabled).toBe(true);
  failToken = 0;
  expect((await req('POST', '/calendar/retry', {})).json().processed).toBe(1);
  await req('DELETE', '/calendar');
  expect((await req('GET', '')).json().connections).toEqual([]);
  expect(
    (await db.query('SELECT id FROM google_sync_items WHERE connection_id=$1', [id])).rowCount,
  ).toBe(0);
  expect(events.size).toBe(1);
  const n = requests.length;
  await runGoogleSync(pool, options);
  expect(requests).toHaveLength(n);
});
it('requires reconnect after revoked credentials and supports explicitly selected upcoming backfill', async () => {
  const appointment = await book();
  const id = await ready('sheets');
  expect((await req('GET', '')).json().connections[0].counts.pending).toBe(0);
  expect(
    (
      await req('PUT', '/sheets/settings', {
        enabled: true,
        acceptsExport: true,
        includeUpcoming: true,
      })
    ).statusCode,
  ).toBe(200);
  failToken = 400;
  await syncGoogleConnection(pool, options, clinic.clinicId, id);
  expect((await req('GET', '')).json().connections[0].enabled).toBe(false);
  failToken = 0;
  await authorize('sheets');
  await req('PUT', '/sheets/settings', { enabled: true, acceptsExport: true });
  await pending();
  await runGoogleSync(pool, options);
  expect(
    (await db.query('SELECT status FROM google_sync_items WHERE appointment_id=$1', [appointment]))
      .rows[0].status,
  ).toBe('synced');
});
it('lets an unrelated new booking complete while Google delivery is waiting', async () => {
  const id = await ready();
  await book();
  let release!: () => void, started!: () => void;
  const seen = new Promise<void>((r) => (started = r)),
    hold = new Promise<void>((r) => (release = r));
  const slow = {
    ...options,
    fetchImpl: async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]).includes('/events')) {
        started();
        await hold;
      }
      return fakeFetch(...args);
    },
  };
  const delivery = syncGoogleConnection(pool, slow, clinic.clinicId, id);
  await seen;
  try {
    const booking = withClinic(pool, clinic.clinicId, async (c) => {
      await c.query("SET LOCAL lock_timeout='1s'");
      return c.query(
        "INSERT INTO appointments(clinic_id,patient_id,doctor_id,starts_at,ends_at,status) VALUES($1,$2,$3,now()+interval '4 days',now()+interval '4 days 15 minutes','booked')",
        [clinic.clinicId, patient, clinic.doctorIds[0]],
      );
    });
    expect((await booking).rowCount).toBe(1);
  } finally {
    release();
    await delivery;
  }
});
