import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withClinic } from '@sahayak/db';
import { callTool, ToolError, type ToolContext } from '@sahayak/core';
import type { AppDeps } from './app';
import {
  razorpayRequest,
  razorpayOrderSchema,
  razorpayPaymentSchema,
  verifyPaymentSignature,
} from './razorpay';
const tokenInput = z.object({ accessToken: z.string().regex(/^[a-f0-9]{64}$/) });
const idInput = z.object({ id: z.string().uuid() });
export async function installOnlinePayments(
  app: FastifyInstance,
  deps: AppDeps,
  staffContext: (
    req: FastifyRequest,
    roles?: ('admin' | 'doctor' | 'receptionist')[],
  ) => Promise<ToolContext>,
) {
  const scoped = <T>(clinic: string, fn: (db: any) => Promise<T>) =>
    withClinic(deps.pool, clinic, fn);
  const credentials = (clinic: string) => {
    const c = deps.razorpay?.clinics[clinic];
    if (!c)
      throw new ToolError(
        'payment_setup',
        'The clinic has not connected online payments yet.',
        409,
      );
    return c;
  };
  const provider = (clinic: string, path: string, body?: unknown) => {
    credentials(clinic);
    return razorpayRequest(deps.razorpay!, clinic, path, body);
  };
  const hits = new Map<string, { n: number; until: number }>();
  const limit = (ip: string) => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.until <= now) hits.delete(k);
    const b = hits.get(ip) ?? { n: 0, until: now + 60000 };
    if (hits.size >= 10000 && !hits.has(ip))
      throw new ToolError('rate_limit', 'Try again shortly', 429);
    hits.set(ip, b);
    if (++b.n > 120) throw new ToolError('rate_limit', 'Please wait before checking again.', 429);
  };
  async function patient(req: FastifyRequest) {
    limit(req.ip);
    const { slug } = z.object({ slug: z.string().max(100) }).parse(req.params);
    const c = (await deps.pool.query('SELECT id FROM clinics WHERE slug=$1', [slug])).rows[0];
    if (!c) throw new ToolError('not_found', 'Clinic not found', 404);
    const { accessToken } = tokenInput.parse(req.body);
    const arrival = await scoped(
      c.id,
      async (db) =>
        (
          await db.query(
            "SELECT *,expires_at>now() valid,to_char(arrival_date,'YYYY-MM-DD') arrival_day FROM qr_arrivals WHERE access_hash=$1",
            [createHash('sha256').update(accessToken).digest('hex')],
          )
        ).rows[0],
    );
    if (!arrival) throw new ToolError('not_found', 'Check-in not found', 404);
    return { clinicId: c.id, arrival };
  }
  const orderFor = (clinic: string, arrival: string) =>
    scoped(
      clinic,
      async (db) =>
        (await db.query('SELECT * FROM qr_payment_orders WHERE arrival_id=$1', [arrival])).rows[0],
    );
  async function settle(clinic: string, order: any, payment: unknown) {
    const p = razorpayPaymentSchema.parse(payment);
    if (
      p.order_id !== order.provider_order_id ||
      p.currency !== 'INR' ||
      p.amount !== order.amount_paise
    )
      throw new ToolError(
        'payment_mismatch',
        'The payment amount or order does not match this check-in.',
        409,
      );
    if (p.amount_refunded === 0 && (p.status !== 'captured' || !p.captured))
      return { state: 'pending' };
    return callTool(
      { pool: deps.pool, bus: deps.bus, channel: deps.whatsapp?.messaging },
      { clinicId: clinic, actor: { kind: 'system', name: 'razorpay-verifier' } },
      'settle_qr_online_payment',
      {
        id: order.id,
        keyId: credentials(clinic).keyId,
        orderId: p.order_id,
        paymentId: p.id,
        amountPaise: p.amount,
        currency: p.currency,
        refundedPaise: p.amount_refunded,
        method:
          p.method === 'upi'
            ? 'upi'
            : p.method === 'card'
              ? 'card'
              : p.method === 'netbanking'
                ? 'bank'
                : 'other',
      },
    );
  }
  async function reconcile(clinic: string, order: any) {
    if (!order?.provider_order_id) return { state: order?.state ?? 'not_started' };
    if (order.key_id !== credentials(clinic).keyId)
      throw new ToolError(
        'payment_account_changed',
        'Restore the original payment account to verify this order.',
        409,
      );
    const result = z
      .object({ items: z.array(razorpayPaymentSchema) })
      .parse(await provider(clinic, '/orders/' + order.provider_order_id + '/payments'));
    const captured = result.items.filter(
      (p) => p.captured || p.status === 'captured' || p.amount_refunded > 0,
    );
    if (captured.length > 1)
      throw new ToolError(
        'payment_review',
        'Multiple captured payments need provider review.',
        409,
      );
    if (captured[0]) return settle(clinic, order, captured[0]);
    return { state: order.state };
  }
  app.get('/staff/payments/setup', async (req) => {
    const ctx = await staffContext(req, ['admin']);
    const c = deps.razorpay?.clinics[ctx.clinicId];
    return scoped(ctx.clinicId, async (db) => {
      const s = (
        await db.query('SELECT online_payment_enabled,public_web_url FROM clinic_qr_settings')
      ).rows[0];
      return {
        configured: !!c,
        enabled: s?.online_payment_enabled ?? false,
        mode: c?.keyId.startsWith('rzp_live_') ? 'live' : 'test',
        webhookPath: '/integrations/razorpay/' + ctx.clinicId,
        publicAddressReady: !!s?.public_web_url?.startsWith('https://'),
        message: c
          ? 'Keys are saved. Complete a test checkout and verify a payment before live use.'
          : 'Add this clinic’s Razorpay keys and webhook secret privately on the server.',
      };
    });
  });
  app.put('/staff/payments/setup', async (req) => {
    const ctx = await staffContext(req, ['admin']);
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    const c = enabled ? credentials(ctx.clinicId) : undefined;
    await scoped(ctx.clinicId, async (db) => {
      const s = (await db.query('SELECT * FROM clinic_qr_settings FOR UPDATE')).rows[0];
      if (!s) throw new ToolError('qr_setup', 'Save the QR check-in settings first.');
      if (enabled && (!s.enabled || s.amount_paise < 100))
        throw new ToolError('qr_setup', 'Enable QR check-in and set a fee of at least ₹1.');
      if (enabled && c!.keyId.startsWith('rzp_live_') && !s.public_web_url?.startsWith('https://'))
        throw new ToolError(
          'https_required',
          'Live payments require a public HTTPS patient-page address.',
          409,
        );
      await db.query('UPDATE clinic_qr_settings SET online_payment_enabled=$1,updated_at=now()', [
        enabled,
      ]);
    });
    return { ok: true };
  });
  app.get('/staff/payments', async (req) => {
    const ctx = await staffContext(req, ['admin']);
    return scoped(ctx.clinicId, async (db) => ({
      orders: (
        await db.query(
          "SELECT id,state,amount_paise,currency,(key_id LIKE 'rzp_test_%') test_mode,provider_order_id,provider_payment_id,detail,verified_at,created_at FROM qr_payment_orders ORDER BY created_at DESC LIMIT 100",
        )
      ).rows,
    }));
  });
  app.post('/staff/payments/:id/refresh', async (req) => {
    const ctx = await staffContext(req, ['admin']);
    const { id } = idInput.parse(req.params);
    const o = await scoped(
      ctx.clinicId,
      async (db) => (await db.query('SELECT * FROM qr_payment_orders WHERE id=$1', [id])).rows[0],
    );
    if (!o) throw new ToolError('not_found', 'Payment not found', 404);
    return reconcile(ctx.clinicId, o);
  });
  app.post('/staff/payments/:id/recover', async (req) => {
    const ctx = await staffContext(req, ['admin']);
    const { id } = idInput.parse(req.params);
    const { orderId } = z
      .object({ orderId: z.string().regex(/^order_[A-Za-z0-9]+$/) })
      .strict()
      .parse(req.body);
    const remote = razorpayOrderSchema.parse(await provider(ctx.clinicId, '/orders/' + orderId));
    await scoped(ctx.clinicId, async (db) => {
      const o = (await db.query('SELECT * FROM qr_payment_orders WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      if (!o) throw new ToolError('not_found', 'Payment not found', 404);
      if (!['unknown', 'creating'].includes(o.state) || o.provider_order_id)
        throw new ToolError('conflict', 'This order is already linked.', 409);
      if (
        o.key_id !== credentials(ctx.clinicId).keyId ||
        remote.receipt !== o.id ||
        remote.amount !== o.amount_paise ||
        remote.currency !== 'INR'
      )
        throw new ToolError('payment_mismatch', 'Provider order does not match this receipt.', 409);
      await db.query(
        "UPDATE qr_payment_orders SET provider_order_id=$2,state='ready',detail=NULL,updated_at=now() WHERE id=$1",
        [id, remote.id],
      );
    });
    return { ok: true };
  });
  app.post('/public/:slug/arrival/payment/order', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const { clinicId, arrival } = await patient(req);
    const c = credentials(clinicId);
    const prepared = await scoped(clinicId, async (db) => {
      const a = (await db.query('SELECT * FROM qr_arrivals WHERE id=$1 FOR UPDATE', [arrival.id]))
        .rows[0];
      const s = (await db.query('SELECT * FROM clinic_qr_settings')).rows[0];
      if (!s?.enabled || !s.online_payment_enabled)
        throw new ToolError(
          'payment_paused',
          'Online payment is not enabled. Please speak with reception.',
          409,
        );
      if (!a || a.status !== 'awaiting_payment' || !arrival.valid)
        throw new ToolError('arrival_closed', 'This check-in is no longer awaiting payment.', 409);
      const day = (
        await db.query(
          "SELECT to_char(now() AT TIME ZONE timezone,'YYYY-MM-DD') AS clinic_day FROM clinics WHERE id=$1",
          [clinicId],
        )
      ).rows[0].clinic_day;
      if (arrival.arrival_day !== day)
        throw new ToolError('arrival_closed', 'Start a check-in for today.', 409);
      if (c.keyId.startsWith('rzp_live_') && !s.public_web_url?.startsWith('https://'))
        throw new ToolError(
          'https_required',
          'Live payment is unavailable until HTTPS setup is complete.',
          409,
        );
      const existing = (
        await db.query('SELECT * FROM qr_payment_orders WHERE arrival_id=$1', [a.id])
      ).rows[0];
      if (existing) return { order: existing, create: false };
      if (a.amount_paise < 100)
        throw new ToolError('amount', 'Online payments require a fee of at least ₹1.');
      const order = (
        await db.query(
          'INSERT INTO qr_payment_orders(clinic_id,arrival_id,key_id,amount_paise) VALUES($1,$2,$3,$4) RETURNING *',
          [clinicId, a.id, c.keyId, a.amount_paise],
        )
      ).rows[0];
      return { order, create: true };
    });
    let order = prepared.order;
    if (prepared.create) {
      try {
        const remote = razorpayOrderSchema.parse(
          await provider(clinicId, '/orders', {
            amount: order.amount_paise,
            currency: 'INR',
            receipt: order.id,
            partial_payment: false,
          }),
        );
        if (
          remote.amount !== order.amount_paise ||
          remote.currency !== 'INR' ||
          remote.receipt !== order.id
        )
          throw Error();
        await scoped(clinicId, async (db) =>
          db.query(
            "UPDATE qr_payment_orders SET provider_order_id=$2,state='ready',updated_at=now() WHERE id=$1",
            [order.id, remote.id],
          ),
        );
        order = { ...order, provider_order_id: remote.id, state: 'ready' };
      } catch {
        await scoped(clinicId, async (db) =>
          db.query(
            "UPDATE qr_payment_orders SET state='unknown',detail='Order creation was not confirmed. Setup team: find the receipt in Razorpay and link its order. Do not create a second order.',updated_at=now() WHERE id=$1",
            [order.id],
          ),
        );
        throw new ToolError(
          'payment_unknown',
          'Payment setup needs reception review. Do not pay again.',
          409,
        );
      }
    }
    if (order.state !== 'ready' || order.key_id !== c.keyId)
      throw new ToolError(
        'payment_review',
        'This payment needs reception review. Do not pay again.',
        409,
      );
    return {
      keyId: c.keyId,
      orderId: order.provider_order_id,
      amountPaise: order.amount_paise,
      currency: 'INR',
      mode: c.keyId.startsWith('rzp_live_') ? 'live' : 'test',
    };
  });
  app.post('/public/:slug/arrival/payment/verify', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const { clinicId, arrival } = await patient(req);
    const b = tokenInput
      .extend({
        paymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
        signature: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(req.body);
    const o = await orderFor(clinicId, arrival.id);
    const c = credentials(clinicId);
    if (
      !o?.provider_order_id ||
      o.key_id !== c.keyId ||
      !verifyPaymentSignature(o.provider_order_id + '|' + b.paymentId, b.signature, c.keySecret)
    )
      throw new ToolError('invalid_signature', 'Payment verification failed.', 400);
    return settle(clinicId, o, await provider(clinicId, '/payments/' + b.paymentId));
  });
  app.post('/public/:slug/arrival/payment/status', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const { clinicId, arrival } = await patient(req);
    return reconcile(clinicId, await orderFor(clinicId, arrival.id));
  });
  app.post('/integrations/razorpay/:clinicId', { bodyLimit: 262144 }, async (req) => {
    const { clinicId } = z.object({ clinicId: z.string().uuid() }).parse(req.params);
    const c = credentials(clinicId);
    const signature = String(req.headers['x-razorpay-signature'] ?? '');
    if (!verifyPaymentSignature(String((req as any).rawBody ?? ''), signature, c.webhookSecret))
      throw new ToolError('invalid_signature', 'Invalid payment webhook signature', 401);
    const body = z.object({ event: z.string(), payload: z.any() }).parse(req.body);
    if (!['payment.captured', 'order.paid', 'refund.processed'].includes(body.event))
      return { received: true };
    const paymentId =
      body.event === 'refund.processed'
        ? body.payload?.refund?.entity?.payment_id
        : body.payload?.payment?.entity?.id;
    if (
      !z
        .string()
        .regex(/^pay_[A-Za-z0-9]+$/)
        .safeParse(paymentId).success
    )
      throw new ToolError('invalid_payment', 'Missing payment identifier');
    // Fetch fresh provider state even for a signed webhook; delayed/replayed events cannot override refunds.
    const payment = razorpayPaymentSchema.parse(await provider(clinicId, '/payments/' + paymentId));
    const o = await scoped(
      clinicId,
      async (db) =>
        (
          await db.query(
            'SELECT * FROM qr_payment_orders WHERE key_id=$1 AND provider_order_id=$2',
            [c.keyId, payment.order_id],
          )
        ).rows[0],
    );
    if (!o) return { received: true, matched: false };
    await settle(clinicId, o, payment);
    return { received: true };
  });
}
