import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { withClinic } from '@sahayak/db';
import { handleInbound, type AgentEnv } from '@sahayak/agents';
import { MockWhatsAppChannel } from '@sahayak/core';
const Binding = z.object({
  clinicId: z.string().uuid(),
  appId: z.string().uuid(),
  secret: z.string().min(32),
});
export const BridgeBindings = z.record(z.string().uuid(), Binding);
export type WhatsAppBridgeOptions = z.infer<typeof BridgeBindings>;
export function bridgeFromEnv(env = process.env): WhatsAppBridgeOptions | undefined {
  if (!env.AGENT_CHANNEL_BRIDGE_BINDINGS) return undefined;
  // Fail closed for malformed configuration; the rest of the clinic app stays available.
  try {
    return BridgeBindings.parse(JSON.parse(env.AGENT_CHANNEL_BRIDGE_BINDINGS));
  } catch {
    return undefined;
  }
}
export interface BridgeProvisioning {
  url: string;
  secret: string;
}
export function provisioningFromEnv(env = process.env): BridgeProvisioning | undefined {
  try {
    const u = new URL(env.AGENT_CHANNEL_BRIDGE_URL ?? '');
    if (
      (u.protocol !== 'https:' &&
        !(u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) ||
      u.pathname !== '/integrations/agent-platform/whatsapp' ||
      u.search ||
      u.hash ||
      u.username ||
      u.password ||
      (env.AGENT_CHANNEL_BRIDGE_SECRET?.length ?? 0) < 32
    )
      return undefined;
    return { url: u.toString(), secret: env.AGENT_CHANNEL_BRIDGE_SECRET! };
  } catch {
    return undefined;
  }
}
export function channelSecret(
  config: BridgeProvisioning,
  clinicId: string,
  appId: string,
  channelId: string,
) {
  return createHmac('sha256', config.secret)
    .update([clinicId, appId, channelId].join(':'))
    .digest('hex');
}
const Input = z
  .object({
    event_id: z.string().uuid(),
    channel_id: z.string().uuid(),
    app_id: z.string().uuid(),
    clinic_id: z.string().uuid(),
    from: z.string().regex(/^\+?[1-9]\d{7,14}$/),
    text: z.string().min(1).max(4000),
    probe: z.literal(true).optional(),
  })
  .strict();
export function installWhatsAppBridge(
  app: FastifyInstance,
  env: AgentEnv,
  bindings: WhatsAppBridgeOptions = {},
  provisioning?: BridgeProvisioning,
) {
  app.post('/integrations/agent-platform/whatsapp', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const input = Input.safeParse(req.body);
    if (!input.success) return reply.code(400).send({ error: 'Invalid message' });
    const i = input.data;
    let b = bindings[i.channel_id];
    if (!b && provisioning) {
      const row = await withClinic(
        env.rt.pool,
        i.clinic_id,
        async (db) =>
          (
            await db.query(
              "SELECT channel_app_id FROM clinic_whatsapp_setup WHERE clinic_id=$1 AND channel_id=$2 AND state='CONNECTED'",
              [i.clinic_id, i.channel_id],
            )
          ).rows[0],
      );
      if (row && row.channel_app_id === i.app_id)
        b = {
          clinicId: i.clinic_id,
          appId: i.app_id,
          secret: channelSecret(provisioning, i.clinic_id, i.app_id, i.channel_id),
        };
    }
    const raw = (req as unknown as { rawBody: string }).rawBody;
    const stamp = req.headers['x-agent-timestamp'],
      signature = req.headers['x-agent-signature'];
    if (
      !b ||
      b.clinicId !== i.clinic_id ||
      b.appId !== i.app_id ||
      typeof stamp !== 'string' ||
      !/^\d{10}$/.test(stamp) ||
      Math.abs(Date.now() / 1000 - Number(stamp)) > 300 ||
      typeof signature !== 'string' ||
      !/^[a-f0-9]{64}$/.test(signature)
    )
      return reply.code(403).send({ error: 'Invalid bridge authentication' });
    const expected = createHmac('sha256', b.secret)
      .update(stamp + '.' + raw)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      return reply.code(403).send({ error: 'Invalid bridge authentication' });
    if (i.probe) {
      const ready = await withClinic(env.rt.pool, b.clinicId, async (db) => {
        await db.query('SELECT 1 FROM agent_platform_receipts LIMIT 1');
        return (await db.query('SELECT 1 FROM clinics WHERE id=$1', [b.clinicId])).rowCount;
      });
      return ready
        ? { ready: true, clinic_id: b.clinicId }
        : reply.code(409).send({ error: 'Clinic unavailable' });
    }
    const digest = createHash('sha256').update(JSON.stringify(i)).digest('hex');
    const contact = '+' + i.from.replace(/^\+/, '');
    // A session lock serializes this patient across worker requests, including different events.
    const lock = await env.rt.pool.connect();
    let acquired = false;
    const lockKey = b.clinicId + ':whatsapp:' + contact;
    try {
      acquired = (
        await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [lockKey])
      ).rows[0].locked;
      if (!acquired)
        return reply.code(409).send({ error: 'Conversation busy; reconcile saved event status' });
      const receipt = await withClinic(env.rt.pool, b.clinicId, async (db) => {
        const inserted = await db.query(
          `INSERT INTO agent_platform_receipts(clinic_id,channel_id,event_id,digest,state) VALUES($1,$2,$3,$4,'PROCESSING') ON CONFLICT DO NOTHING RETURNING event_id`,
          [b.clinicId, i.channel_id, i.event_id, digest],
        );
        const row = (
          await db.query(
            'SELECT * FROM agent_platform_receipts WHERE clinic_id=$1 AND channel_id=$2 AND event_id=$3',
            [b.clinicId, i.channel_id, i.event_id],
          )
        ).rows[0];
        return { fresh: !!inserted.rowCount, row };
      });
      if (receipt.row.digest !== digest)
        return reply.code(409).send({ error: 'Event content changed' });
      if (receipt.row.state === 'DONE' && receipt.row.response) return receipt.row.response;
      if (!receipt.fresh)
        return reply.code(409).send({ error: 'Event outcome needs reconciliation' });
      try {
        // Replies are captured and stored locally; ONLY the platform sends to WhatsApp.
        const result = await handleInbound(
          { ...env, rt: { ...env.rt, channel: new MockWhatsAppChannel() } },
          { clinicId: b.clinicId, from: contact, text: i.text, channel: 'whatsapp' },
        );
        const response = {
          event_id: i.event_id,
          replies: result.replies,
          handledBy: result.handledBy,
          redFlag: result.redFlag,
        };
        const combined = result.replies.join('\n\n');
        if (combined.length > 4000) throw new Error('Reply too long');
        await withClinic(env.rt.pool, b.clinicId, (db) =>
          db.query(
            `UPDATE agent_platform_receipts SET state='DONE',response=$4,conversation_id=(SELECT id FROM conversations WHERE id=$5) WHERE clinic_id=$1 AND channel_id=$2 AND event_id=$3`,
            [b.clinicId, i.channel_id, i.event_id, JSON.stringify(response), result.conversationId],
          ),
        );
        return response;
      } catch {
        await withClinic(env.rt.pool, b.clinicId, (db) =>
          db.query(
            `UPDATE agent_platform_receipts SET state='UNKNOWN',response=NULL WHERE clinic_id=$1 AND channel_id=$2 AND event_id=$3`,
            [b.clinicId, i.channel_id, i.event_id],
          ),
        );
        return reply.code(503).send({ error: 'Event outcome needs reconciliation' });
      }
    } finally {
      try {
        if (acquired)
          await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey]);
      } finally {
        lock.release();
      }
    }
  });
}
