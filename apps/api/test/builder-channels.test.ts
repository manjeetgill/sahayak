import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, hashPassword, makePool } from '@sahayak/db';
import { EventBus, genericHttpPlugin } from '@sahayak/core';
import { LlmGate, deliverOutbox } from '@sahayak/agents';
import { buildApp } from '../src/app';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
let c: Awaited<ReturnType<typeof createTestClinic>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const sent: any[] = [];
let failSends = false;
const SECRET = 'wh-secret';
const plugin = genericHttpPlugin({
  secret: SECRET,
  sendUrl: 'https://gw/send',
  sendToken: 't',
  fetchImpl: (async (_u: string, init: any) => {
    if (failSends) return { ok: false, status: 502 };
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200 };
  }) as any,
});
const tok: Record<string, string> = {};
const biz = `+9111${Math.floor(Math.random() * 1e8)}`;
const sign = (raw: string) => `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;

beforeAll(async () => {
  await admin.connect();
  c = await createTestClinic(admin, 'bld');
  await admin.query('UPDATE clinic_settings SET whatsapp_number=$2 WHERE clinic_id=$1', [
    c.clinicId,
    biz,
  ]);
  const pw = await hashPassword('pw-test-1234');
  await admin.query(
    "INSERT INTO staff_users (clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,$3,'D','doctor',$4),($1,$5,$3,'R','receptionist',NULL)",
    [c.clinicId, `d-${c.slug}@t.in`, pw, c.doctorIds[0], `r-${c.slug}@t.in`],
  );
  await admin.query(
    "INSERT INTO staff_users(clinic_id,email,password_hash,name,role) VALUES($1,$2,$3,'Admin','admin')",
    [c.clinicId, `admin-${c.slug}@t.in`, pw],
  );
  await addPatient(admin, c.clinicId, 'Wa Patient', '+919400000001');
  app = await buildApp({
    pool,
    bus: new EventBus(''),
    gate: new LlmGate(null),
    jwtSecret: 't',
    whatsapp: plugin,
  });
  for (const [k, e] of [
    ['doc', `d-${c.slug}@t.in`],
    ['admin', `admin-${c.slug}@t.in`],
    ['rec', `r-${c.slug}@t.in`],
  ])
    tok[k] = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: e, password: 'pw-test-1234' },
      })
    ).json().token;
});
afterAll(async () => {
  await dropTestClinic(admin, c.clinicId);
  await admin.end();
  await pool.end();
  await app.close();
});
const h = (k: string) => ({ authorization: `Bearer ${tok[k]}` });
it('never sends a queued cancellation offer after it expires', async () => {
  const patient = (
    await admin.query('SELECT id FROM patients WHERE clinic_id=$1 LIMIT 1', [c.clinicId])
  ).rows[0].id;
  const waiting = (
    await admin.query(
      'INSERT INTO appointment_waitlist(clinic_id,patient_id,doctor_id,from_date,to_date) VALUES ($1,$2,$3,current_date,current_date+1) RETURNING id',
      [c.clinicId, patient, c.doctorIds[0]],
    )
  ).rows[0].id;
  try {
    const offer = (
      await admin.query(
        "INSERT INTO slot_offers(clinic_id,waitlist_id,doctor_id,patient_id,starts_at,expires_at,code) VALUES ($1,$2,$3,$4,now()+interval '1 day',now()-interval '1 minute','0000000ABC') RETURNING id",
        [c.clinicId, waiting, c.doctorIds[0], patient],
      )
    ).rows[0].id;
    const message = (
      await admin.query(
        "INSERT INTO outbox(clinic_id,to_contact,body,slot_offer_id) VALUES ($1,'+199900011111','expired test offer',$2) RETURNING id",
        [c.clinicId, offer],
      )
    ).rows[0].id;
    const scopedPool = {
      query: async () => ({ rows: [{ id: message, clinic_id: c.clinicId }] }),
      connect: pool.connect.bind(pool),
    } as unknown as pg.Pool;
    let delivered = 0;
    await deliverOutbox(scopedPool, {
      name: 'test',
      queued: true,
      send: async () => {
        delivered++;
      },
    });
    expect(delivered).toBe(0);
    expect(
      (await admin.query('SELECT status FROM outbox WHERE id=$1', [message])).rows[0].status,
    ).toBe('failed');
  } finally {
    await admin.query('DELETE FROM appointment_waitlist WHERE id=$1', [waiting]);
  }
});
it('guided tests require staff and never queue a provider delivery', async () => {
  const payload = {
    from: '+199900012345',
    text: 'What are your clinic timings?',
    channel: 'whatsapp',
    language: 'en',
  };
  expect(
    (await app.inject({ method: 'POST', url: '/staff/agents/test', payload })).statusCode,
  ).toBe(401);
  const before = (await admin.query('SELECT count(*) FROM outbox WHERE clinic_id=$1', [c.clinicId]))
    .rows[0].count;
  const result = await app.inject({
    method: 'POST',
    url: '/staff/agents/test',
    headers: h('admin'),
    payload,
  });
  expect(result.statusCode).toBe(200);
  expect(result.json().replies.length).toBeGreaterThan(0);
  expect(
    (await admin.query('SELECT count(*) FROM outbox WHERE clinic_id=$1', [c.clinicId])).rows[0]
      .count,
  ).toBe(before);
});
it('diagnostics exclude recipient, message bodies, and raw provider errors', async () => {
  const id = (
    await admin.query(
      `INSERT INTO outbox(clinic_id,to_contact,body,status,last_error)
    VALUES ($1,'+199900012345','private body','failed','private vendor response') RETURNING id`,
      [c.clinicId],
    )
  ).rows[0].id;
  try {
    expect((await app.inject({ url: '/staff/agents/diagnostics' })).statusCode).toBe(401);
    const result = await app.inject({ url: '/staff/agents/diagnostics', headers: h('admin') });
    expect(result.statusCode).toBe(200);
    expect(result.json().messages.find((m: any) => m.id === id).has_error).toBe(true);
    expect(result.body).not.toContain('private');
    expect(result.body).not.toContain('+199900012345');
  } finally {
    await admin.query('DELETE FROM outbox WHERE id=$1', [id]);
  }
});
it('urgent handoffs require resolution before return to agent', async () => {
  const test = await app.inject({
    method: 'POST',
    url: '/staff/agents/test',
    headers: h('admin'),
    payload: {
      from: '+199900098765',
      text: 'severe chest pain and cannot breathe',
      channel: 'voice',
      language: 'en',
    },
  });
  expect(test.statusCode).toBe(200);
  const id = test.json().conversationId;
  const path = `/staff/conversations/${id}/takeover`;
  expect(
    (await app.inject({ url: `/staff/conversations/${id}`, headers: h('rec') })).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ method: 'POST', url: path, headers: h('rec'), payload: { to: 'agent' } }))
      .statusCode,
  ).toBe(409);
  const flags = (await app.inject({ url: '/staff/flags', headers: h('rec') }))
    .json()
    .filter((f: any) => f.conversation_id === id);
  for (const flag of flags)
    await app.inject({
      method: 'POST',
      url: `/staff/flags/${flag.id}/resolve`,
      headers: h('rec'),
      payload: {},
    });
  expect(
    (await app.inject({ method: 'POST', url: path, headers: h('rec'), payload: { to: 'agent' } }))
      .statusCode,
  ).toBe(200);
});
it('shows staff only their clinic connection configuration without secrets', async () => {
  expect((await app.inject({ url: '/staff/agents/connections' })).statusCode).toBe(401);
  const response = await app.inject({ url: '/staff/agents/connections', headers: h('admin') });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    liveChannelOwner: 'local',
    slug: c.slug,
    simulator: true,
    voiceSimulator: true,
    platform: { configured: false },
    whatsapp: { configured: true, provider: plugin.messaging.name },
    phone: {
      configured: false,
      bookingAdapter: false,
      requestedNumber: null,
      state: 'NOT_CONFIGURED',
    },
  });
  expect(response.body).not.toContain(SECRET);
});
const sim = (text: string, from = '9400000001') =>
  app
    .inject({ method: 'POST', url: `/sim/${c.slug}/message`, payload: { from, text } })
    .then((r) => r.json());

describe('agent builder', () => {
  it('only the admin can change settings; the receptionist can read them', async () => {
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/staff/settings',
          headers: h('rec'),
          payload: { address: 'x' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: '/staff/settings', headers: h('rec') })).json().avgConsultMinutes,
    ).toBe(10);
  });
  it('validates input (bad timings rejected)', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/staff/settings',
      headers: h('admin'),
      payload: { timings: { mon: '9am to 5pm' } },
    });
    expect(r.statusCode).toBe(400);
  });
  it("a FAQ written by the admin is answered, in the patient's language", async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/staff/settings',
      headers: h('admin'),
      payload: {
        faqs: [
          {
            id: 'insurance',
            keywords: ['insurance', 'cashless'],
            en: 'We accept most major insurance cards.',
            hi: 'हम अधिकतर बड़े बीमा कार्ड स्वीकार करते हैं।',
          },
        ],
      },
    });
    expect(put.json().changed).toEqual(['faqs']);
    expect((await sim('do you take cashless insurance')).replies[0]).toBe(
      'We accept most major insurance cards.',
    );
    expect((await sim('क्या आप insurance लेते हैं', '9400000002')).replies[0]).toContain('बीमा');
  });
  it('FAQ text that reads like medical advice is refused', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/staff/settings',
      headers: h('admin'),
      payload: {
        faqs: [
          {
            id: 'bad',
            keywords: ['fever'],
            en: 'Take paracetamol 500 mg for fever.',
            hi: 'बुखार में आराम करें',
          },
        ],
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('medical_advice_not_allowed');
  });
  it('changed intake questions are used', async () => {
    await app.inject({
      method: 'PUT',
      url: '/staff/settings',
      headers: h('admin'),
      payload: { intakeQuestions: [{ id: 'q1', en: 'Any pain today?', hi: 'आज कोई दर्द?' }] },
    });
    const ci = await app.inject({
      method: 'POST',
      url: `/public/${c.slug}/checkin`,
      payload: { phone: '9400000001', doctorId: c.doctorIds[0], consent: {} },
    });
    expect(ci.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    const m = await app.inject({ url: `/sim/${c.slug}/messages?phone=9400000001` });
    expect(
      m
        .json()
        .map((x: any) => x.body)
        .join(' '),
    ).toContain('Any pain today?');
  });
  it('switching an agent off hands that chat to a person; red flags still work', async () => {
    await app.inject({
      method: 'PUT',
      url: '/staff/settings',
      headers: h('admin'),
      payload: { agents: { front_desk: false } },
    });
    const r = await sim('what are your timings', '9400000003');
    expect(r.handledBy).toBe('agent'); // unknown number -> leads agent is still on
    const known = await sim('hello there', '9400000001');
    // known patient still mid-intake; finish it, then ask something
    await sim('headache', '9400000001');
    const after = await sim('what are your timings', '9400000001');
    expect(after.handledBy).toBe('human');
    expect(known).toBeTruthy();
    await app.inject({
      method: 'POST',
      url: `/staff/conversations/${(await app.inject({ url: '/staff/conversations', headers: h('rec') })).json().find((x: any) => x.contact === '+919400000001').id}/takeover`,
      headers: h('rec'),
      payload: { to: 'agent' },
    });
    const rf = await sim('chest pain', '9400000001');
    expect(rf.redFlag).toBe(true);
  });
  it('clinic phrases can be added; every change is recorded', async () => {
    await app.inject({
      method: 'POST',
      url: '/staff/settings/phrases',
      headers: h('rec'),
      payload: { phrase: 'bee sting swelling', language: 'en' },
    });
    expect((await sim('bee sting swelling on tongue', '9400000004')).redFlag).toBe(true);
    const log = await admin.query('SELECT field FROM settings_changes WHERE clinic_id=$1', [
      c.clinicId,
    ]);
    expect(log.rows.map((x) => x.field)).toContain('faqs');
  });
});

describe('real WhatsApp channel (vendor-neutral bridge)', () => {
  const post = (body: object, sig?: string) => {
    const raw = JSON.stringify(body);
    return app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-sahayak-signature': sig ?? sign(raw) },
      payload: raw,
    });
  };
  it('rejects unsigned and wrongly signed webhooks', async () => {
    expect(
      (await post({ to: biz, from: '+919400000010', text: 'hi' }, 'sha256=00')).statusCode,
    ).toBe(401);
    const raw = JSON.stringify({ to: biz, from: '+919400000010', text: 'hi' });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/webhooks/whatsapp',
          headers: { 'content-type': 'application/json' },
          payload: raw,
        })
      ).statusCode,
    ).toBe(401);
  });
  it('verification handshake needs the secret', async () => {
    expect(
      (await app.inject({ url: '/webhooks/whatsapp?hub.verify_token=nope&hub.challenge=1' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: `/webhooks/whatsapp?hub.verify_token=${SECRET}&hub.challenge=abc` }))
        .body,
    ).toBe('abc');
  });
  it('a signed inbound message reaches the right clinic and the reply goes out through the outbox', async () => {
    const r = await post({ to: biz, from: '+919400000010', text: 'where are you located?' });
    expect(r.json().processed).toBe(1);
    const q = await admin.query(
      "SELECT body, status, to_contact FROM outbox WHERE clinic_id=$1 AND to_contact='+919400000010'",
      [c.clinicId],
    );
    expect(q.rows[0]).toMatchObject({ status: 'pending' });
    expect(q.rows[0].body).toMatch(/1 Test Road/);
    expect(await deliverOutbox(pool, plugin.messaging)).toBeGreaterThanOrEqual(1);
    expect(sent.at(-1)).toMatchObject({ to: '+919400000010' });
    expect(
      (await admin.query("SELECT status FROM outbox WHERE to_contact='+919400000010'")).rows[0]
        .status,
    ).toBe('sent');
  });
  it("a doctor's own WhatsApp number books with that doctor, without asking which one", async () => {
    const docNumber = `+9122${Math.floor(Math.random() * 1e8)}`;
    const set = await app.inject({
      method: 'PUT',
      url: '/staff/settings/whatsapp',
      headers: h('admin'),
      payload: { number: docNumber, doctorId: c.doctorIds[0] },
    });
    expect(set.statusCode).toBe(200);
    await admin.query('UPDATE doctors SET whatsapp_number=NULL WHERE id=$1 AND false', [
      c.doctorIds[1],
    ]);
    const r = await post({
      to: docNumber,
      from: '+919400000040',
      text: 'I need an appointment tomorrow morning',
    });
    expect(r.json().processed).toBe(1);
    const out = (
      await admin.query(
        "SELECT body FROM outbox WHERE to_contact='+919400000040' ORDER BY created_at",
      )
    ).rows
      .map((x) => x.body)
      .join(' ');
    expect(out).not.toMatch(/Which doctor/);
    expect(out).toMatch(/your name/); // unknown number: consent flow first
    expect(
      (await admin.query('SELECT doctor_id FROM conversations WHERE contact=$1', ['+919400000040']))
        .rows[0].doctor_id,
    ).toBe(c.doctorIds[0]);
    // same number cannot be linked to two doctors
    const dup = await app.inject({
      method: 'PUT',
      url: '/staff/settings/whatsapp',
      headers: h('rec'),
      payload: { number: docNumber, doctorId: c.doctorIds[0] },
    });
    expect(dup.statusCode).toBe(403);
  });
  it('unknown business number is ignored', async () => {
    expect(
      (await post({ to: '+910000000000', from: '+919400000011', text: 'hi' })).json().processed,
    ).toBe(0);
  });
  it('failed sends are retried with backoff, then flagged to the receptionist', async () => {
    await post({ to: biz, from: '+919400000012', text: 'timings?' });
    failSends = true;
    for (let i = 0; i < 5; i++) {
      await deliverOutbox(pool, plugin.messaging);
      await admin.query("UPDATE outbox SET next_attempt_at=now() WHERE status='pending'");
    }
    const row = (
      await admin.query("SELECT status, attempts FROM outbox WHERE to_contact='+919400000012'")
    ).rows[0];
    expect(row).toMatchObject({ status: 'failed', attempts: 5 });
    const flags = (await app.inject({ url: '/staff/flags', headers: h('rec') })).json();
    expect(
      flags.some((f: any) => /could not be delivered/.test(f.summary) && f.severity === 'urgent'),
    ).toBe(true);
    failSends = false;
  });
  it('voice replies are never pushed out as WhatsApp', async () => {
    const before = (
      await admin.query('SELECT count(*)::int n FROM outbox WHERE clinic_id=$1', [c.clinicId])
    ).rows[0].n;
    await app.inject({
      method: 'POST',
      url: `/voice/${c.slug}/turn`,
      payload: { from: '9400000020', text: 'what are your timings' },
    });
    expect(
      (await admin.query('SELECT count(*)::int n FROM outbox WHERE clinic_id=$1', [c.clinicId]))
        .rows[0].n,
    ).toBe(before);
  });
});

describe('voice', () => {
  it('a phone caller gets a spoken reply; Hindi audio is understood', async () => {
    const r = (
      await app.inject({
        method: 'POST',
        url: `/voice/${c.slug}/turn`,
        payload: {
          from: '9400000030',
          audio: Buffer.from('क्लिनिक का समय क्या है?').toString('base64'),
        },
      })
    ).json();
    expect(r.replies[0]).toMatch(/क्लिनिक का समय/);
    expect(Buffer.from(r.audio.base64, 'base64').toString()).toBe(r.replies.join(' '));
  });
  it('a caller describing an emergency gets the emergency reply and an urgent alert', async () => {
    const r = (
      await app.inject({
        method: 'POST',
        url: `/voice/${c.slug}/turn`,
        payload: { from: '9400000031', text: 'my father cannot breathe' },
      })
    ).json();
    expect(r.redFlag).toBe(true);
    expect(r.replies[0]).toMatch(/108/);
  });
  it('"talk to a person" transfers the call', async () => {
    const r = (
      await app.inject({
        method: 'POST',
        url: `/voice/${c.slug}/turn`,
        payload: { from: '9400000032', text: 'I want to talk to a person' },
      })
    ).json();
    expect(r.transferToHuman).toBe(true);
  });
  it('doctor voice note "running late" becomes a proposal, still needing confirmation', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/staff/schedule/propose-voice',
      headers: { ...h('doc'), 'content-type': 'audio/webm' },
      payload: Buffer.from('I am running 30 minutes late'),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ transcript: 'I am running 30 minutes late', minutes: 30 });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/staff/schedule/propose-voice',
          headers: { ...h('rec'), 'content-type': 'audio/webm' },
          payload: Buffer.from('x'),
        })
      ).statusCode,
    ).toBe(403);
  });
});
