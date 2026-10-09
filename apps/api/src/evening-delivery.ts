import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ToolError, type ToolContext } from '@sahayak/core';
import { withClinic } from '@sahayak/db';
import type { AppDeps } from './app';
import { whatsappPlatform } from './whatsapp-platform';

const setupSchema = z.object({
  webhook_verified: z.boolean(),
  templates: z.array(
    z.object({ id: z.string(), name: z.string(), language: z.string(), text: z.string() }),
  ),
});
const outboundSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  delivery: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  idempotency_key: z.string().optional(),
});

export async function installEveningDelivery(
  app: FastifyInstance,
  deps: AppDeps,
  staffContext: (
    req: FastifyRequest,
    roles?: ('admin' | 'doctor' | 'receptionist')[],
  ) => Promise<ToolContext>,
) {
  const scoped = <T>(clinic: string, fn: (db: any) => Promise<T>) =>
    withClinic(deps.pool, clinic, fn);
  const channelFor = (clinic: string) =>
    Object.entries(deps.whatsappBridge ?? {}).find(
      ([, binding]) => binding.clinicId === clinic,
    )?.[0];
  async function setup(clinic: string) {
    const settings = await scoped(
      clinic,
      async (db) =>
        (await db.query('SELECT * FROM patient_evening_settings')).rows[0] ?? { enabled: false },
    );
    const channel = settings.channel_id ?? channelFor(clinic);
    if (!channel)
      return {
        settings,
        templates: [],
        ready: false,
        message: 'Connect the clinic WhatsApp account first.',
      };
    try {
      const upstream = await whatsappPlatform(
        deps.whatsappPlatform,
        clinic,
        `/v1/whatsapp/channels/${channel}/send-setup`,
        setupSchema,
      );
      return {
        settings: { ...settings, channel_id: channel },
        templates: upstream.templates,
        ready: upstream.webhook_verified,
        message: upstream.webhook_verified
          ? 'Choose an approved evening message that asks the patient to reply BETTER, SAME or WORSE.'
          : 'Verify the WhatsApp connection first.',
      };
    } catch {
      return {
        settings: { ...settings, channel_id: channel },
        templates: [],
        ready: false,
        message: 'Approved outbound templates are unavailable from the connected platform.',
      };
    }
  }
  app.get('/staff/evening/messaging', async (req) => {
    const ctx = await staffContext(req, ['admin']);
    return { ...(await setup(ctx.clinicId)), jobsEnabled: process.env.JOBS_ENABLED !== 'false' };
  });
  app.put('/staff/evening/messaging', async (req) => {
    const ctx = await staffContext(req, ['admin']);
    const input = z
      .object({
        enabled: z.boolean(),
        templateId: z
          .string()
          .regex(/^\d{5,30}$/)
          .optional(),
        reviewed: z.literal(true),
      })
      .parse(req.body);
    const current = await setup(ctx.clinicId);
    const template = current.templates.find((t) => t.id === input.templateId);
    if (
      input.enabled &&
      (!current.ready ||
        !template ||
        !/\bBETTER\b/i.test(template.text) ||
        !/\bWORSE\b/i.test(template.text))
    )
      throw new ToolError(
        'not_ready',
        'Choose an approved message asking patients to reply BETTER and WORSE, then verify the WhatsApp connection.',
      );
    await scoped(ctx.clinicId, async (db) =>
      db.query(
        `INSERT INTO patient_evening_settings(clinic_id,enabled,channel_id,template_id,reviewed_template,reviewed_by)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(clinic_id) DO UPDATE SET enabled=EXCLUDED.enabled,
       channel_id=EXCLUDED.channel_id,template_id=EXCLUDED.template_id,reviewed_template=EXCLUDED.reviewed_template,
       reviewed_by=EXCLUDED.reviewed_by,updated_at=now()`,
        [
          ctx.clinicId,
          input.enabled,
          current.settings.channel_id ?? null,
          input.templateId ?? null,
          template ? JSON.stringify(template) : null,
          ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
        ],
      ),
    );
    return { ok: true };
  });

  async function dispatch(clinic: string, followUpId: string) {
    return scoped(clinic, async (db) => {
      const f = (
        await db.query(
          `SELECT f.*,p.phone,p.language,p.erasure_requested_at FROM follow_ups f
         JOIN patients p ON p.id=f.patient_id WHERE f.id=$1 FOR UPDATE OF f`,
          [followUpId],
        )
      ).rows[0];
      const setting = (await db.query('SELECT * FROM patient_evening_settings WHERE enabled'))
        .rows[0];
      if (!f || !setting || f.kind !== 'post_visit' || !f.evening_number || f.status !== 'pending')
        return { skipped: true };
      if (new Date(f.run_at) > new Date()) return { skipped: true };
      if (new Date(f.run_at).getTime() < Date.now() - 3 * 3_600_000) {
        await db.query(
          "UPDATE follow_ups SET status='skipped',detail='evening_window_passed' WHERE id=$1",
          [f.id],
        );
        return { skipped: true };
      }
      const inHours = (
        await db.query(
          "SELECT ((now() AT TIME ZONE timezone)::time >= time '18:00' AND (now() AT TIME ZONE timezone)::time < time '21:00') eligible FROM clinics WHERE id=$1",
          [clinic],
        )
      ).rows[0]?.eligible;
      if (!inHours) return { skipped: true, reason: 'outside_evening_hours' };
      const eligible =
        !f.erasure_requested_at &&
        (
          await db.query(
            `SELECT 1 FROM patients WHERE id=$1 AND name<>'Erased patient'
         AND EXISTS(SELECT 1 FROM consents WHERE patient_id=$1 AND purpose='whatsapp_messaging' AND withdrawn_at IS NULL)
         AND EXISTS(SELECT 1 FROM consents WHERE patient_id=$1 AND purpose='reminders_followups' AND withdrawn_at IS NULL)
         AND EXISTS(SELECT 1 FROM consents WHERE patient_id=$1 AND purpose='evening_checkins' AND withdrawn_at IS NULL)`,
            [f.patient_id],
          )
        ).rowCount;
      if (!eligible) {
        await db.query(
          "UPDATE follow_ups SET status='skipped',detail='consent_withdrawn' WHERE id=$1",
          [f.id],
        );
        return { skipped: true };
      }
      const busy = (
        await db.query(
          "SELECT 1 FROM conversations WHERE contact=$1 AND channel='whatsapp' AND (handled_by='human' OR state <> '{}'::jsonb)",
          [f.phone],
        )
      ).rowCount;
      if (busy) {
        await db.query(
          "UPDATE follow_ups SET status='skipped',detail='conversation_in_progress' WHERE id=$1",
          [f.id],
        );
        return { skipped: true };
      }
      let record = (
        await db.query('SELECT * FROM patient_evening_delivery WHERE follow_up_id=$1', [f.id])
      ).rows[0];
      if (record && record.state !== 'blocked') return record;
      if (!record)
        record = (
          await db.query(
            'INSERT INTO patient_evening_delivery(clinic_id,follow_up_id,channel_id) VALUES($1,$2,$3) RETURNING *',
            [clinic, f.id, setting.channel_id],
          )
        ).rows[0];
      let attempted = false;
      try {
        const current = await whatsappPlatform(
          deps.whatsappPlatform,
          clinic,
          `/v1/whatsapp/channels/${setting.channel_id}/send-setup`,
          setupSchema,
        );
        const template = current.templates.find((t) => t.id === setting.template_id);
        if (template && !template.language.toLowerCase().startsWith(f.language)) {
          await db.query(
            "UPDATE patient_evening_delivery SET state='blocked',detail='Approved message language does not match the patient.',updated_at=now() WHERE id=$1",
            [record.id],
          );
          await db.query(
            "UPDATE follow_ups SET status='skipped',detail='language_template_unavailable' WHERE id=$1",
            [f.id],
          );
          return { state: 'blocked', reason: 'language_template_unavailable' };
        }
        if (
          !current.webhook_verified ||
          !template ||
          !setting.reviewed_template ||
          !['id', 'name', 'language', 'text'].every(
            (key) => (template as any)[key] === setting.reviewed_template[key],
          ) ||
          !setting.channel_id
        ) {
          await db.query(
            "UPDATE patient_evening_delivery SET state='blocked',detail='Connection, template or patient language needs review.',updated_at=now() WHERE id=$1",
            [record.id],
          );
          return { state: 'blocked' };
        }
        const base = `/v1/whatsapp/channels/${setting.channel_id}/outbound`;
        attempted = true;
        const draft = await whatsappPlatform(deps.whatsappPlatform, clinic, base, outboundSchema, {
          recipient: f.phone,
          template_id: setting.template_id,
          idempotency_key: `sahayak-evening-${f.id}`,
        });
        await db.query(
          "UPDATE patient_evening_delivery SET provider_id=$2,state='draft' WHERE id=$1",
          [record.id, draft.id],
        );
        const approved = await whatsappPlatform(
          deps.whatsappPlatform,
          clinic,
          `${base}/${draft.id}/approve`,
          outboundSchema,
          { confirm: true, recipient_consented: true },
        );
        const conv = (
          await db.query(
            `INSERT INTO conversations(clinic_id,patient_id,channel,contact,language,state)
           VALUES($1,$2,'whatsapp',$3,$4,$5) ON CONFLICT(clinic_id,channel,contact)
           DO UPDATE SET patient_id=EXCLUDED.patient_id,state=EXCLUDED.state,updated_at=now() RETURNING id`,
            [
              clinic,
              f.patient_id,
              f.phone,
              f.language,
              JSON.stringify({
                flow: 'followup_checkin',
                followUpId: f.id,
                eveningNumber: f.evening_number,
              }),
            ],
          )
        ).rows[0];
        await db.query(
          "INSERT INTO messages(clinic_id,conversation_id,direction,sender,body) VALUES($1,$2,'out','agent:followup',$3)",
          [clinic, conv.id, template.text],
        );
        await db.query("UPDATE follow_ups SET status='sent' WHERE id=$1", [f.id]);
        await db.query(
          'UPDATE patient_evening_delivery SET state=$2,updated_at=now() WHERE id=$1',
          [record.id, approved.status.toLowerCase()],
        );
        return { state: approved.status.toLowerCase() };
      } catch {
        await db.query(
          'UPDATE patient_evening_delivery SET state=$2,detail=$3,updated_at=now() WHERE id=$1',
          [
            record.id,
            attempted ? 'unknown' : 'blocked',
            attempted
              ? 'Provider outcome is uncertain. Check platform history before another send.'
              : 'Connection unavailable before sending.',
          ],
        );
        if (attempted)
          await db.query(
            "UPDATE follow_ups SET status='failed',detail='provider_outcome_unknown' WHERE id=$1",
            [f.id],
          );
        return { state: attempted ? 'unknown' : 'blocked' };
      }
    });
  }

  async function refresh(clinic: string) {
    const setting = await scoped(
      clinic,
      async (db) => (await db.query('SELECT channel_id FROM patient_evening_settings')).rows[0],
    );
    if (!setting?.channel_id) return;
    const history = await whatsappPlatform(
      deps.whatsappPlatform,
      clinic,
      `/v1/whatsapp/channels/${setting.channel_id}/outbound`,
      z.array(outboundSchema),
    );
    await scoped(clinic, async (db) => {
      for (const item of history) {
        const delivery = (item.delivery ?? item.status).toLowerCase();
        await db.query(
          `UPDATE patient_evening_delivery SET provider_id=COALESCE(provider_id,$1),
           state=CASE WHEN read_at IS NOT NULL OR $4 THEN 'read' WHEN delivered_at IS NOT NULL OR $3 THEN 'delivered' ELSE $2 END,
           delivered_at=CASE WHEN $3 THEN COALESCE(delivered_at,now()) ELSE delivered_at END,
           read_at=CASE WHEN $4 THEN COALESCE(read_at,now()) ELSE read_at END,
           last_checked_at=now(),detail=CASE WHEN $5 THEN 'Provider could not complete delivery.' ELSE detail END,updated_at=now()
           WHERE (provider_id=$1 OR (provider_id IS NULL AND $6=('sahayak-evening-'||follow_up_id::text)))`,
          [
            item.id,
            item.status.toLowerCase(),
            ['delivered', 'read'].includes(delivery),
            delivery === 'read',
            !!item.error,
            item.idempotency_key ?? null,
          ],
        );
      }
    });
  }
  app.get('/staff/evening/delivery-evidence', async (req) => {
    const ctx = await staffContext(req, ['admin']);
    return scoped(ctx.clinicId, async (db) => ({
      summary: (
        await db.query(`SELECT count(*)::int attempts,
        count(*) FILTER(WHERE delivered_at IS NOT NULL)::int delivered,
        count(*) FILTER(WHERE state IN ('unknown','blocked','failed'))::int needs_review
        FROM patient_evening_delivery`)
      ).rows[0],
    }));
  });
  app.post('/staff/evening/delivery-refresh', async (req) => {
    const ctx = await staffContext(req, ['admin']);
    await refresh(ctx.clinicId);
    return { ok: true };
  });
  app.post('/staff/evening/:id/send', async (req) => {
    const ctx = await staffContext(req, ['doctor']);
    z.object({ approved: z.literal(true) }).parse(req.body);
    const id = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    return dispatch(ctx.clinicId, id);
  });
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      for (const clinic of (await deps.pool.query('SELECT id FROM clinics_for_sweeps()')).rows) {
        const enabled = await scoped(
          clinic.id,
          async (db) =>
            (await db.query('SELECT 1 FROM patient_evening_settings WHERE enabled')).rowCount,
        );
        if (!enabled) continue;
        await refresh(clinic.id).catch(() => {});
        const due = await scoped(clinic.id, async (db) => {
          await db.query(
            "UPDATE follow_ups SET status='skipped',detail='evening_window_passed' WHERE evening_number IS NOT NULL AND status='pending' AND run_at<now()-interval '3 hours'",
          );
          return (
            await db.query(
              `SELECT id FROM follow_ups WHERE evening_number IS NOT NULL AND status='pending'
             AND run_at<=now() AND NOT EXISTS
             (SELECT 1 FROM patient_evening_delivery d WHERE d.follow_up_id=follow_ups.id AND d.state<>'blocked')
             ORDER BY run_at LIMIT 50`,
            )
          ).rows;
        });
        for (const row of due) await dispatch(clinic.id, row.id);
      }
    } catch {
      app.log.warn('Evening message sweep needs review');
    } finally {
      running = false;
    }
  };
  let timer: NodeJS.Timeout | undefined;
  app.addHook('onReady', async () => {
    if (process.env.JOBS_ENABLED !== 'false' && process.env.NODE_ENV !== 'test')
      timer = setInterval(() => void sweep(), 60000);
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
}
