import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, createHmac } from 'node:crypto';
import pg from 'pg';
import { createTestClinic, dropTestClinic, makePool } from '@sahayak/db';
import { EventBus, callTool } from '@sahayak/core';
import { LlmGate } from '@sahayak/agents';
import { buildApp } from '../src/app';
import { razorpayFromEnv } from '../src/razorpay';
const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL }),
  pool = makePool(),
  bus = new EventBus('');
let clinic: Awaited<ReturnType<typeof createTestClinic>>,
  other: typeof clinic,
  app: Awaited<ReturnType<typeof buildApp>>;
const users: Record<string, string> = {},
  keyId = 'rzp_test_TestAccount',
  keySecret = 'provider-secret-test',
  webhookSecret = 'webhook-secret-test';
const orders: any[] = [];
const payments = new Map<string, any>();
let uncertain = false;
const sign = (s: string, key = keySecret) => createHmac('sha256', key).update(s).digest('hex');
const headers = (role = 'admin') => ({
  authorization:
    'Bearer ' +
    app.jwt.sign({ uid: users[role], clinicId: clinic.clinicId, role, name: 'Payment test' }),
});
const staff = (method: any, url: string, payload?: any, role = 'admin') =>
  app.inject({ method, url, payload, headers: headers(role) });
const pub = (i: any, action: string, extra = {}) =>
  app.inject({
    method: 'POST',
    url: `/public/${clinic.slug}/arrival/payment/${action}`,
    payload: { accessToken: i.accessToken, ...extra },
  });
async function arrive() {
  const i = {
    accessToken: randomBytes(32).toString('hex'),
    name: 'Synthetic online patient',
    phone: '+919' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
    doctorId: clinic.doctorIds[0],
    language: 'en',
    consent: { visit_data: true, whatsapp_messaging: false, reminders_followups: false },
  };
  const r = await app.inject({ method: 'POST', url: `/public/${clinic.slug}/arrival`, payload: i });
  expect(r.statusCode, r.body).toBe(200);
  return i;
}
async function start() {
  const i = await arrive();
  const r = await pub(i, 'order');
  expect(r.statusCode, r.body).toBe(200);
  return { i, order: r.json() };
}
const capture = (order: any, extra = {}) => {
  const p = {
    id: 'pay_' + order.orderId.slice(6),
    order_id: order.orderId,
    amount: 50000,
    currency: 'INR',
    status: 'captured',
    captured: true,
    amount_refunded: 0,
    method: 'upi',
    ...extra,
  };
  payments.set(p.id, p);
  return p;
};
const verify = (i: any, p: any, signature = sign(p.order_id + '|' + p.id)) =>
  pub(i, 'verify', { paymentId: p.id, signature });
async function stored(orderId: string) {
  return (await db.query('SELECT * FROM qr_payment_orders WHERE provider_order_id=$1', [orderId]))
    .rows[0];
}
async function webhook(p: any, event = 'payment.captured', secret = webhookSecret) {
  const payload = JSON.stringify({
    event,
    payload:
      event === 'refund.processed'
        ? { refund: { entity: { payment_id: p.id } } }
        : { payment: { entity: p } },
  });
  return app.inject({
    method: 'POST',
    url: '/integrations/razorpay/' + clinic.clinicId,
    payload,
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(payload, secret) },
  });
}
beforeAll(async () => {
  await db.connect();
  clinic = await createTestClinic(db, 'online');
  other = await createTestClinic(db, 'online-other');
  for (const role of ['admin', 'doctor', 'receptionist'])
    users[role] = (
      await db.query(
        "INSERT INTO staff_users(clinic_id,email,name,role,password_hash) VALUES($1,$2,$3,$3,'unused') RETURNING id",
        [clinic.clinicId, role + clinic.slug + '@test.invalid', role],
      )
    ).rows[0].id;
  app = await buildApp({
    pool,
    bus,
    gate: new LlmGate(null),
    jwtSecret: 'online-test',
    razorpay: {
      clinics: { [clinic.clinicId]: { keyId, keySecret, webhookSecret } },
      fetchImpl: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          const o = { ...body, id: 'order_Test' + (orders.length + 1), status: 'created' };
          orders.push(o);
          if (uncertain) throw Error('lost response');
          return Response.json(o);
        }
        const payment = path.match(/\/payments\/(pay_\w+)$/);
        if (payment)
          return Response.json(payments.get(payment[1]) ?? {}, {
            status: payments.has(payment[1]) ? 200 : 404,
          });
        const list = path.match(/\/orders\/(order_\w+)\/payments$/);
        if (list)
          return Response.json({
            items: [...payments.values()].filter((p) => p.order_id === list[1]),
          });
        const order = orders.find((o) => path.endsWith('/' + o.id));
        return Response.json(order ?? {}, { status: order ? 200 : 404 });
      },
    },
  });
  expect(
    (
      await staff('PUT', '/staff/qr-settings', {
        enabled: true,
        amountPaise: 50000,
        publicWebUrl: 'http://192.168.1.5:3000',
      })
    ).statusCode,
  ).toBe(200);
});
afterAll(async () => {
  await app.close();
  await dropTestClinic(db, clinic.clinicId);
  await dropTestClinic(db, other.clinicId);
  await db.end();
  await pool.end();
});
it('requires admin activation and exposes no secret keys', async () => {
  expect((await pub(await arrive(), 'order')).statusCode).toBe(409);
  expect(
    (await staff('PUT', '/staff/payments/setup', { enabled: true }, 'doctor')).statusCode,
  ).toBe(403);
  expect((await staff('PUT', '/staff/payments/setup', { enabled: true })).statusCode).toBe(200);
  const setup = await staff('GET', '/staff/payments/setup');
  expect(setup.json()).toMatchObject({ configured: true, enabled: true, mode: 'test' });
  expect(setup.body).not.toContain(keySecret);
  expect(setup.body).not.toContain(webhookSecret);
  expect(() => razorpayFromEnv({ RAZORPAY_CLINIC_CREDENTIALS: 'invalid' } as any)).toThrow();
});
it('creates one order under concurrent clicks and rejects manual payment after online checkout starts', async () => {
  const i = await arrive(),
    count = orders.length;
  const rs = await Promise.all([pub(i, 'order'), pub(i, 'order')]);
  expect(orders.length).toBe(count + 1);
  expect(rs.some((r) => r.statusCode === 200)).toBe(true);
  const o = (await pub(i, 'order')).json();
  const storedOrder = await stored(o.orderId);
  const r = await staff(
    'POST',
    '/staff/qr-arrivals/' + storedOrder.arrival_id + '/confirm',
    { method: 'cash', confirmed: true },
    'receptionist',
  );
  expect(r.statusCode).toBe(409);
  expect((await staff('GET', '/staff/payments', undefined, 'doctor')).statusCode).not.toBe(200);
});
it('rejects forged proof, amount/currency mismatch and merely authorized payments', async () => {
  const { i, order } = await start();
  let p = capture(order, { status: 'authorized', captured: false });
  expect((await verify(i, p)).json().state).toBe('pending');
  expect((await verify(i, p, '0'.repeat(64))).statusCode).toBe(400);
  p = capture(order, { amount: 100 });
  expect((await verify(i, p)).statusCode).toBe(409);
  p = capture(order, { currency: 'USD' });
  expect((await verify(i, p)).statusCode).toBe(409);
  expect((await stored(order.orderId)).charge_id).toBeNull();
});
it('verifies captured payment exactly once across browser/webhook retries and updates the queue', async () => {
  const { i, order } = await start(),
    p = capture(order);
  const bad = await webhook(p, 'payment.captured', 'wrong-secret');
  expect(bad.statusCode).toBe(401);
  const rs = await Promise.all([verify(i, p), webhook(p), webhook(p)]);
  for (const r of rs) expect(r.statusCode, r.body).toBe(200);
  const o = await stored(order.orderId);
  expect(o.state).toBe('captured');
  const ledger = (await db.query('SELECT * FROM clinic_payments WHERE charge_id=$1', [o.charge_id]))
    .rows;
  expect(ledger).toHaveLength(1);
  expect(ledger[0]).toMatchObject({
    recorded_by: null,
    is_test: true,
    source: 'razorpay',
    provider_payment_id: p.id,
    amount_paise: 50000,
  });
  const arrival = (await db.query('SELECT * FROM qr_arrivals WHERE id=$1', [o.arrival_id])).rows[0];
  expect(arrival.status).toBe('queued');
  expect(arrival.queue_entry_id).toBeTruthy();
  const publicStatus = await app.inject({
    method: 'POST',
    url: `/public/${clinic.slug}/arrival/status`,
    payload: { accessToken: i.accessToken },
  });
  expect(publicStatus.json()).toMatchObject({
    paidPaise: 50000,
    onlineState: 'captured',
    visitStatus: 'waiting',
  });
  const otherRead = await app.inject({
    method: 'POST',
    url: `/public/${other.slug}/arrival/payment/status`,
    payload: { accessToken: i.accessToken },
  });
  expect(otherRead.statusCode).toBe(404);
});
it('uses reconciliation when the browser callback is lost and flags refunds without another queue entry', async () => {
  const { i, order } = await start(),
    p = capture(order);
  expect((await pub(i, 'status')).json().state).toBe('captured');
  const before = await stored(order.orderId);
  payments.set(p.id, { ...p, status: 'refunded', amount_refunded: 50000 });
  expect((await webhook(p, 'refund.processed')).statusCode).toBe(200);
  expect((await stored(order.orderId)).state).toBe('review');
  expect(
    (
      await db.query('SELECT count(*)::int n FROM clinic_payments WHERE charge_id=$1', [
        before.charge_id,
      ])
    ).rows[0].n,
  ).toBe(1);
});
it('records money received after cancellation for review without queuing or losing it', async () => {
  const { i, order } = await start(),
    o = await stored(order.orderId);
  await staff('POST', '/staff/qr-arrivals/' + o.arrival_id + '/cancel', {}, 'receptionist');
  const p = capture(order);
  expect((await verify(i, p)).json().state).toBe('review');
  const paid = await stored(order.orderId);
  expect(paid.charge_id).toBeTruthy();
  expect(
    (await db.query('SELECT queue_entry_id FROM qr_arrivals WHERE id=$1', [o.arrival_id])).rows[0]
      .queue_entry_id,
  ).toBeNull();
  expect((await webhook(p)).statusCode).toBe(200);
  expect(
    (
      await db.query('SELECT count(*)::int n FROM clinic_payments WHERE charge_id=$1', [
        paid.charge_id,
      ])
    ).rows[0].n,
  ).toBe(1);
});
it('fences uncertain order creation, supports verified receipt recovery, and never creates a second provider order', async () => {
  const i = await arrive();
  uncertain = true;
  const count = orders.length;
  expect((await pub(i, 'order')).statusCode).toBe(409);
  uncertain = false;
  expect((await pub(i, 'order')).statusCode).toBe(409);
  expect(orders.length).toBe(count + 1);
  const remote = orders.at(-1),
    o = (await db.query('SELECT * FROM qr_payment_orders WHERE id=$1', [remote.receipt])).rows[0];
  expect(
    (await staff('POST', `/staff/payments/${o.id}/recover`, { orderId: orders[0].id })).statusCode,
  ).toBe(409);
  expect(
    (await staff('POST', `/staff/payments/${o.id}/recover`, { orderId: remote.id })).statusCode,
  ).toBe(200);
  expect((await pub(i, 'order')).json().orderId).toBe(remote.id);
});
it('does not allow patients or staff to invoke trusted settlement directly', async () => {
  await expect(
    callTool(
      { pool, bus },
      { clinicId: clinic.clinicId, actor: { kind: 'patient' } },
      'settle_qr_online_payment',
      {},
    ),
  ).rejects.toMatchObject({ status: 403 });
});

it('excludes test money from collections and blocks live checkout without HTTPS', async () => {
  const overview = await callTool(
    { pool, bus },
    { clinicId: clinic.clinicId, actor: { kind: 'staff', role: 'doctor', userId: users.doctor } },
    'get_practice_overview',
    {},
  );
  expect(Number(overview.finances.collected)).toBe(0);
  expect(Number(overview.finances.outstanding)).toBe(0);
  const live = await buildApp({
    pool,
    bus,
    gate: new LlmGate(null),
    jwtSecret: 'online-test',
    razorpay: {
      clinics: { [clinic.clinicId]: { keyId: 'rzp_live_TestAccount', keySecret, webhookSecret } },
      fetchImpl: async () => {
        throw Error('Must not reach provider');
      },
    },
  });
  try {
    const r = await live.inject({
      method: 'PUT',
      url: '/staff/payments/setup',
      headers: headers(),
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('https_required');
    const i = await arrive();
    expect(
      (
        await live.inject({
          method: 'POST',
          url: `/public/${clinic.slug}/arrival/payment/order`,
          payload: { accessToken: i.accessToken },
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    await live.close();
  }
});
