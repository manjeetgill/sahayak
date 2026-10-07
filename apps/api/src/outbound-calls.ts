import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ToolError, type ToolContext } from '@sahayak/core';
import { withClinic } from '@sahayak/db';
import { PhoneSchema } from '@sahayak/shared';
import type { AppDeps } from './app';
import { callingRequest } from './calling-status';
const capability = z.object({
  ready: z.boolean(),
  enabled: z.boolean(),
  outbound: z
    .object({
      contract_version: z.literal(1),
      supported: z.boolean(),
      enabled: z.boolean(),
      allowed_test_numbers: z.array(PhoneSchema),
    })
    .optional(),
});
const receipt = z.object({
  request_id: z.string().uuid(),
  call_id: z.string().uuid().nullable(),
  status: z.enum(['accepted', 'ringing', 'answered', 'completed', 'failed', 'unknown']),
});
export async function installOutboundCalls(
  app: FastifyInstance,
  deps: AppDeps,
  staffContext: (
    req: FastifyRequest,
    roles?: ('admin' | 'doctor' | 'receptionist')[],
  ) => Promise<ToolContext>,
) {
  const scoped = <T>(clinic: string, fn: (db: any) => Promise<T>) =>
    withClinic(deps.pool, clinic, fn);
  async function readiness(clinic: string) {
    try {
      const r = await callingRequest(
        deps.callingBridge,
        deps.whatsappPlatform,
        clinic,
        'readiness',
        capability,
      );
      const supported = !!r.outbound?.supported;
      return {
        ready: !!(r.ready && r.enabled && r.outbound?.enabled && supported),
        supported,
        numbers: r.outbound?.allowed_test_numbers ?? [],
        message: !supported
          ? 'The connected platform has not enabled outbound test calls yet. Incoming-call readiness does not enable outgoing calls.'
          : !r.ready || !r.enabled || !r.outbound?.enabled
            ? 'Complete voice setup and enable outbound test calling in the platform.'
            : 'You can call a provider-approved test number. Provider charges may apply.',
      };
    } catch {
      return {
        ready: false,
        supported: false,
        numbers: [],
        message: 'Connect the clinic phone service before testing outgoing calls.',
      };
    }
  }
  app.get('/staff/agents/calling/outbound', async (req) => {
    const ctx = await staffContext(req, ['admin']);
    return {
      ...(await readiness(ctx.clinicId)),
      calls: await scoped(
        ctx.clinicId,
        async (db) =>
          (
            await db.query(
              'SELECT id,status,right(destination,4) last_four,provider_call_id,detail,created_at,updated_at FROM outbound_call_requests ORDER BY created_at DESC LIMIT 50',
            )
          ).rows,
      ),
    };
  });
  app.post('/staff/agents/calling/outbound', async (req) => {
    const ctx = await staffContext(req, ['admin']);
    const i = z
      .object({
        requestId: z.string().uuid(),
        destination: PhoneSchema,
        ownsNumber: z.literal(true),
        acceptsCharges: z.literal(true),
      })
      .strict()
      .parse(req.body);
    const previous = await scoped(
      ctx.clinicId,
      async (db) =>
        (
          await db.query('SELECT id,status,destination FROM outbound_call_requests WHERE id=$1', [
            i.requestId,
          ])
        ).rows[0],
    );
    if (previous) {
      if (previous.destination !== i.destination)
        throw new ToolError('conflict', 'This call reference was used for another number.', 409);
      return { id: previous.id, status: previous.status };
    }
    const ready = await readiness(ctx.clinicId);
    if (!ready.ready || !ready.numbers.includes(i.destination))
      throw new ToolError(
        'outbound_not_ready',
        'Choose a provider-approved test number after outbound calling is enabled.',
        409,
      );
    const agent = Object.entries(deps.callingBridge ?? {}).find(
      ([, v]) => v.clinicId === ctx.clinicId,
    )![0];
    const inserted = await scoped(ctx.clinicId, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        ctx.clinicId + ':outbound-test',
      ]);
      const existing = (
        await db.query('SELECT id,status,destination FROM outbound_call_requests WHERE id=$1', [
          i.requestId,
        ])
      ).rows[0];
      if (existing) {
        if (existing.destination !== i.destination)
          throw new ToolError('conflict', 'Call reference already used', 409);
        return { created: false, ...existing };
      }
      if (
        (
          await db.query(
            "SELECT id FROM outbound_call_requests WHERE destination=$1 AND status IN ('submitting','accepted','ringing','answered','unknown')",
            [i.destination],
          )
        ).rowCount
      )
        throw new ToolError(
          'call_pending',
          'A call is already pending. Refresh its status before starting another.',
          409,
        );
      if (
        (
          await db.query(
            "SELECT id FROM outbound_call_requests WHERE created_at>now()-interval '1 hour'",
          )
        ).rowCount >= 5
      )
        throw new ToolError('call_limit', 'The test limit is five calls per hour.', 429);
      await db.query(
        "INSERT INTO outbound_call_requests(id,clinic_id,requested_by,destination,agent_id,status) VALUES($1,$2,$3,$4,$5,'submitting')",
        [
          i.requestId,
          ctx.clinicId,
          ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
          i.destination,
          agent,
        ],
      );
      return { created: true, id: i.requestId, status: 'submitting' };
    });
    if (!inserted.created) return { id: inserted.id, status: inserted.status };
    try {
      const r = await callingRequest(
        deps.callingBridge,
        deps.whatsappPlatform,
        ctx.clinicId,
        'outbound',
        receipt,
        {
          request_id: i.requestId,
          destination: i.destination,
          test_only: true,
          recipient_consented: true,
          accepts_charges: true,
        },
      );
      if (r.request_id !== i.requestId) throw Error('wrong receipt');
      await scoped(ctx.clinicId, async (db) =>
        db.query(
          'UPDATE outbound_call_requests SET status=$2,provider_call_id=$3,updated_at=now() WHERE id=$1',
          [i.requestId, r.status, r.call_id],
        ),
      );
      return { id: i.requestId, status: r.status };
    } catch {
      await scoped(ctx.clinicId, async (db) =>
        db.query(
          "UPDATE outbound_call_requests SET status='unknown',detail='The call request could not be confirmed. Check provider status before another attempt.',updated_at=now() WHERE id=$1",
          [i.requestId],
        ),
      );
      return { id: i.requestId, status: 'unknown' };
    }
  });
  app.post('/staff/agents/calling/outbound/:id/refresh', async (req) => {
    const ctx = await staffContext(req, ['admin']);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const stored = await scoped(
      ctx.clinicId,
      async (db) =>
        (await db.query('SELECT agent_id FROM outbound_call_requests WHERE id=$1', [id])).rows[0],
    );
    if (!stored) throw new ToolError('not_found', 'Call not found', 404);
    const agent = Object.entries(deps.callingBridge ?? {}).find(
      ([, v]) => v.clinicId === ctx.clinicId,
    )?.[0];
    if (agent !== stored.agent_id)
      throw new ToolError(
        'calling_changed',
        'The calling connection changed. Check the original platform call history.',
        409,
      );
    const r = await callingRequest(
      deps.callingBridge,
      deps.whatsappPlatform,
      ctx.clinicId,
      `outbound/${id}`,
      receipt,
    );
    if (r.request_id !== id)
      throw new ToolError('wrong_receipt', 'Provider returned a different call reference.', 502);
    await scoped(ctx.clinicId, async (db) =>
      db.query(
        'UPDATE outbound_call_requests SET status=$2,provider_call_id=$3,detail=NULL,updated_at=now() WHERE id=$1',
        [id, r.status, r.call_id],
      ),
    );
    return { ok: true };
  });
}
