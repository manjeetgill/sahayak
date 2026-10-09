import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps } from './app';
import { z } from 'zod';
import { callTool, ToolError, type ToolContext } from '@sahayak/core';
import { withClinic } from '@sahayak/db';
import { checkRedFlag, analysePatientFeedback } from '@sahayak/agents';
import { whatsappPlatform } from './whatsapp-platform';
import { patientMessageJobsEnabled } from '@sahayak/shared';

const idSchema = z.object({ id: z.string().uuid() });
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
export async function installPatientFeedback(
  app: FastifyInstance,
  deps: AppDeps,
  staffContext: (
    req: FastifyRequest,
    roles?: ('admin' | 'doctor' | 'receptionist')[],
  ) => Promise<ToolContext>,
) {
  const rt = { pool: deps.pool, bus: deps.bus };
  const scoped = <T>(clinic: string, fn: (db: any) => Promise<T>) =>
    withClinic(deps.pool, clinic, fn);
  const tool = (ctx: ToolContext, name: string, input: unknown) => callTool(rt, ctx, name, input);
  const id = (req: FastifyRequest) => idSchema.parse(req.params).id;
  const rate = new Map<string, { count: number; until: number }>();
  async function patient(req: FastifyRequest, reply: any) {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    const now = Date.now();
    for (const [k, v] of rate) if (v.until < now) rate.delete(k);
    const k = req.ip;
    const hit = rate.get(k) ?? { count: 0, until: now + 60000 };
    hit.count++;
    rate.set(k, hit);
    if (hit.count > 60)
      throw new ToolError('rate_limit', 'Please wait a minute and try again', 429);
    const { slug } = z.object({ slug: z.string().max(100) }).parse(req.params);
    const c = (await deps.pool.query('SELECT id FROM clinics WHERE slug=$1', [slug])).rows[0];
    if (!c) throw new ToolError('not_found', 'Clinic not found', 404);
    return { clinicId: c.id, actor: { kind: 'patient' as const } };
  }
  app.post('/public/:slug/feedback/open', async (req, reply) =>
    tool(await patient(req, reply), 'read_feedback_link', req.body),
  );
  app.post('/public/:slug/feedback/response', async (req, reply) => {
    const ctx = await patient(req, reply);
    const saved = await tool(ctx, 'submit_patient_feedback', req.body);
    // Save first, then run the existing second safety layer; an unavailable model cannot lose a response.
    if (saved.checkinId && !saved.urgent) {
      const response = z
        .object({
          message: z.string().max(2000).default(''),
          suggestion: z.string().max(1000).default(''),
        })
        .parse(req.body);
      const message = `${response.message}\n${response.suggestion}`;
      const phrases = await scoped(
        ctx.clinicId,
        async (db) => (await db.query('SELECT phrase FROM red_flag_phrases')).rows,
      );
      const rf = await checkRedFlag(deps.gate, message, phrases);
      if (rf.hit) {
        await scoped(ctx.clinicId, async (db) =>
          db.query('UPDATE patient_checkins SET urgent=true WHERE id=$1', [saved.checkinId]),
        );
        saved.urgent = true;
      }
    }
    return { saved: true, urgent: saved.urgent ?? false };
  });
  app.post('/public/:slug/feedback/resolution', async (req, reply) =>
    tool(await patient(req, reply), 'resolve_patient_feedback', req.body),
  );
  app.post('/public/:slug/feedback/stop', async (req, reply) =>
    tool(await patient(req, reply), 'stop_patient_feedback', req.body),
  );
  app.get('/staff/feedback', async (req) =>
    tool(await staffContext(req), 'list_feedback_work', req.query),
  );
  app.post('/staff/feedback/:id/link', async (req) =>
    tool(await staffContext(req), 'prepare_feedback_link', {
      ...z.object({ purpose: z.enum(['response', 'resolution']) }).parse(req.body),
      id: id(req),
    }),
  );
  app.patch('/staff/feedback/:id', async (req) =>
    tool(await staffContext(req), 'update_feedback_case', { ...(req.body as object), id: id(req) }),
  );
  app.get('/staff/feedback/report', async (req) =>
    tool(await staffContext(req, ['doctor']), 'feedback_report', {}),
  );
  app.post('/staff/feedback/improvements', async (req) =>
    tool(await staffContext(req, ['doctor']), 'save_feedback_improvement', req.body),
  );
  app.post('/staff/feedback/:id/analyse', async (req) => {
    const ctx = await staffContext(req, ['doctor']);
    const checkin = id(req);
    const row = await scoped(
      ctx.clinicId,
      async (db) =>
        (
          await db.query(
            "SELECT concat_ws(E'\\n',message,suggestion) AS message FROM patient_feedback_responses WHERE checkin_id=$1",
            [checkin],
          )
        ).rows[0],
    );
    if (!row) throw new ToolError('not_found', 'No patient response found', 404);
    const analysis = await analysePatientFeedback(deps.gate, row.message);
    await scoped(ctx.clinicId, async (db) => {
      await db.query('UPDATE patient_checkins SET analysis=$2 WHERE id=$1', [
        checkin,
        JSON.stringify(analysis),
      ]);
      await db.query(
        "INSERT INTO patient_feedback_events(clinic_id,checkin_id,actor_id,kind) VALUES($1,$2,$3,'analysis_prepared')",
        [ctx.clinicId, checkin, ctx.actor.kind === 'staff' ? ctx.actor.userId : null],
      );
    });
    return analysis;
  });
  async function messagingSetup(ctx: ToolContext) {
    const bindings = Object.entries(deps.whatsappBridge ?? {}).filter(
      ([, b]) => b.clinicId === ctx.clinicId,
    );
    const settings = await scoped(
      ctx.clinicId,
      async (db) =>
        (await db.query('SELECT * FROM patient_feedback_settings')).rows[0] ?? { enabled: false },
    );
    const channel = settings.channel_id ?? bindings[0]?.[0];
    const publicUrl = process.env.CHECKIN_PUBLIC_WEB_URL;
    const publicReady = !!publicUrl && /^https:\/\//.test(publicUrl);
    if (!channel)
      return {
        settings,
        templates: [],
        ready: false,
        message: 'Connect the clinic WhatsApp account first.',
      };
    try {
      const setup = await whatsappPlatform(
        deps.whatsappPlatform,
        ctx.clinicId,
        `/v1/whatsapp/channels/${channel}/send-setup`,
        setupSchema,
      );
      const invitations = setup.templates.filter((t) => /\bfeedback\b/i.test(t.text));
      return {
        settings: { ...settings, channel_id: channel },
        templates: invitations,
        ready: setup.webhook_verified && publicReady && invitations.length > 0,
        message: !publicReady
          ? 'A public HTTPS address for the patient form is required. Local demo links still work.'
          : !setup.webhook_verified
            ? 'Verify the WhatsApp connection first.'
            : !invitations.length
              ? 'No approved feedback invitation is available yet. WhatsApp must approve the message before automatic sending can be enabled. You can still demonstrate the private feedback form.'
              : 'Select a reviewed template that asks patients to reply FEEDBACK. The patient then receives their private form link.',
      };
    } catch {
      return {
        settings: { ...settings, channel_id: channel },
        templates: [],
        ready: false,
        message:
          'The connected platform cannot currently provide approved outbound templates. Use a private form link for the demo. No WhatsApp message has been sent.',
      };
    }
  }
  app.get('/staff/feedback/messaging', async (req) => ({
    ...(await messagingSetup(await staffContext(req, ['admin']))),
    jobsEnabled: patientMessageJobsEnabled(process.env),
  }));
  app.put('/staff/feedback/messaging', async (req) => {
    const ctx = await staffContext(req, ['admin']);
    const b = z
      .object({
        enabled: z.boolean(),
        templateId: z
          .string()
          .regex(/^\d{5,30}$/)
          .optional(),
        reviewed: z.literal(true),
      })
      .parse(req.body);
    const setup = await messagingSetup(ctx);
    const template = setup.templates.find((t) => t.id === b.templateId);
    if (b.enabled && (!setup.ready || !template || !/\bfeedback\b/i.test(template.text)))
      throw new ToolError(
        'not_ready',
        'Choose an approved template asking patients to reply FEEDBACK, and complete the public link setup.',
      );
    await scoped(ctx.clinicId, async (db) =>
      db.query(
        'INSERT INTO patient_feedback_settings(clinic_id,enabled,channel_id,template_id,reviewed_template,reviewed_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(clinic_id) DO UPDATE SET enabled=EXCLUDED.enabled,channel_id=EXCLUDED.channel_id,template_id=EXCLUDED.template_id,reviewed_template=EXCLUDED.reviewed_template,reviewed_by=EXCLUDED.reviewed_by,updated_at=now()',
        [
          ctx.clinicId,
          b.enabled,
          setup.settings.channel_id ?? null,
          b.templateId ?? null,
          template ? JSON.stringify(template) : null,
          ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
        ],
      ),
    );
    return { ok: true };
  });
  async function dispatch(clinicId: string, checkinId: string, kind: 'initial' | 'reminder') {
    // Lock throughout preparation and approval. An uncertain request is never auto-retried.
    return scoped(clinicId, async (db) => {
      const c = (
        await db.query(
          'SELECT c.*,p.phone FROM patient_checkins c JOIN patients p ON p.id=c.patient_id WHERE c.id=$1 FOR UPDATE OF c',
          [checkinId],
        )
      ).rows[0];
      const settings = (await db.query('SELECT * FROM patient_feedback_settings WHERE enabled'))
        .rows[0];
      if (!c || !settings || c.status !== 'scheduled' || c.work_status !== 'planned')
        return { skipped: true };
      const eligible = (
        await db.query(
          "SELECT 1 FROM patients WHERE id=$1 AND erasure_requested_at IS NULL AND EXISTS(SELECT 1 FROM consents WHERE patient_id=$1 AND purpose='whatsapp_messaging' AND withdrawn_at IS NULL) AND EXISTS(SELECT 1 FROM consents WHERE patient_id=$1 AND purpose='reminders_followups' AND withdrawn_at IS NULL) AND extract(hour FROM now() AT TIME ZONE (SELECT timezone FROM clinics WHERE id=$2)) BETWEEN 8 AND 20",
          [c.patient_id, clinicId],
        )
      ).rowCount;
      if (!eligible) return { skipped: true };
      if (new Date(c.scheduled_at) > new Date()) return { skipped: true };
      if (
        kind === 'reminder' &&
        (!c.reminder_enabled ||
          !(
            await db.query(
              "SELECT 1 FROM patient_feedback_delivery WHERE checkin_id=$1 AND kind='initial' AND delivered_at<now()-interval '2 days'",
              [checkinId],
            )
          ).rowCount)
      )
        return { skipped: true };
      let row = (
        await db.query('SELECT * FROM patient_feedback_delivery WHERE checkin_id=$1 AND kind=$2', [
          checkinId,
          kind,
        ])
      ).rows[0];
      if (row && row.state !== 'blocked') return row;
      if (!row)
        row = (
          await db.query(
            'INSERT INTO patient_feedback_delivery(clinic_id,checkin_id,kind,channel_id) VALUES($1,$2,$3,$4) RETURNING *',
            [clinicId, checkinId, kind, settings.channel_id],
          )
        ).rows[0];
      let providerAttempted = false;
      try {
        const setup = await whatsappPlatform(
          deps.whatsappPlatform,
          clinicId,
          `/v1/whatsapp/channels/${settings.channel_id}/send-setup`,
          setupSchema,
        );
        const current = setup.templates.find((t) => t.id === settings.template_id);
        if (
          !setup.webhook_verified ||
          !current ||
          !settings.reviewed_template ||
          !['id', 'name', 'language', 'text'].every(
            (k) => (current as any)[k] === settings.reviewed_template[k],
          ) ||
          !process.env.CHECKIN_PUBLIC_WEB_URL?.startsWith('https://')
        ) {
          await db.query(
            "UPDATE patient_feedback_delivery SET state='blocked',detail='The invitation or connection changed. Review WhatsApp message settings again.',updated_at=now() WHERE id=$1",
            [row.id],
          );
          return { state: 'blocked' };
        }
        const base = `/v1/whatsapp/channels/${settings.channel_id}/outbound`;
        providerAttempted = true;
        const draft = await whatsappPlatform(
          deps.whatsappPlatform,
          clinicId,
          base,
          outboundSchema,
          {
            recipient: c.phone,
            template_id: settings.template_id,
            idempotency_key: `sahayak-checkin-${checkinId}-${kind}`,
          },
        );
        await db.query(
          "UPDATE patient_feedback_delivery SET provider_id=$2,state='draft' WHERE id=$1",
          [row.id, draft.id],
        );
        const approved = await whatsappPlatform(
          deps.whatsappPlatform,
          clinicId,
          `${base}/${draft.id}/approve`,
          outboundSchema,
          { confirm: true, recipient_consented: true },
        );
        await db.query(
          'UPDATE patient_feedback_delivery SET state=$2,updated_at=now() WHERE id=$1',
          [row.id, approved.status.toLowerCase()],
        );
        return { state: approved.status.toLowerCase() };
      } catch {
        await db.query(
          'UPDATE patient_feedback_delivery SET state=$2,detail=$3,updated_at=now() WHERE id=$1',
          [
            row.id,
            providerAttempted ? 'unknown' : 'blocked',
            providerAttempted
              ? 'Preparation or approval could not be confirmed. Check platform history before another send.'
              : 'Connection unavailable before preparation. Will check again; no message dispatched.',
          ],
        );
        return { state: providerAttempted ? 'unknown' : 'blocked' };
      }
    });
  }
  async function refreshDelivery(clinicId: string) {
    const channels = await scoped(
      clinicId,
      async (db) =>
        (
          await db.query(
            `SELECT DISTINCT COALESCE(d.channel_id,s.channel_id) channel FROM patient_feedback_delivery d
       LEFT JOIN patient_feedback_settings s ON s.clinic_id=d.clinic_id`,
          )
        ).rows,
    );
    for (const { channel } of channels) {
      if (!channel) continue;
      const history = await whatsappPlatform(
        deps.whatsappPlatform,
        clinicId,
        `/v1/whatsapp/channels/${channel}/outbound`,
        z.array(outboundSchema),
      );
      await scoped(clinicId, async (db) => {
        for (const h of history) {
          const delivery = (h.delivery ?? h.status).toLowerCase();
          const delivered = ['delivered', 'read'].includes(delivery);
          // Provider acceptance is not a delivery receipt. Never lose observed delivered/read evidence.
          await db.query(
            `UPDATE patient_feedback_delivery SET
            provider_id=COALESCE(provider_id,$1),
            state=CASE WHEN read_at IS NOT NULL OR $5 THEN 'read' WHEN delivered_at IS NOT NULL OR $4 THEN 'delivered' ELSE $2 END,
            detail=$3,delivered_at=CASE WHEN $4 THEN COALESCE(delivered_at,now()) ELSE delivered_at END,
            read_at=CASE WHEN $5 THEN COALESCE(read_at,now()) ELSE read_at END,
            last_checked_at=now(),updated_at=now()
            WHERE (channel_id=$6 OR channel_id IS NULL) AND
              (provider_id=$1 OR (provider_id IS NULL AND $7=('sahayak-checkin-'||checkin_id::text||'-'||kind)))`,
            [
              h.id,
              h.status.toLowerCase(),
              h.error ? 'Provider could not complete delivery. Review platform history.' : null,
              delivered,
              delivery === 'read',
              channel,
              h.idempotency_key ?? null,
            ],
          );
        }
      });
    }
  }
  app.get('/staff/feedback/delivery-evidence', async (req) => {
    const ctx = await staffContext(req, ['admin']);
    return scoped(ctx.clinicId, async (db) => ({
      summary: (
        await db.query(`SELECT count(*)::int attempts,
        count(*) FILTER(WHERE delivered_at IS NOT NULL)::int delivered,
        count(*) FILTER(WHERE read_at IS NOT NULL)::int read,
        count(*) FILTER(WHERE state IN ('unknown','blocked','failed'))::int needs_review,
        count(DISTINCT d.checkin_id) FILTER(WHERE delivered_at IS NOT NULL AND EXISTS(SELECT 1 FROM patient_feedback_responses r WHERE r.checkin_id=d.checkin_id AND r.created_at>=d.delivered_at))::int responses_after_delivery
        FROM patient_feedback_delivery d`)
      ).rows[0],
      receipts: (
        await db.query(
          'SELECT id,kind,state,provider_id,delivered_at,read_at,last_checked_at,detail FROM patient_feedback_delivery ORDER BY created_at DESC LIMIT 50',
        )
      ).rows,
    }));
  });
  app.post('/staff/feedback/delivery-refresh', async (req) => {
    const c = await staffContext(req, ['admin']);
    await refreshDelivery(c.clinicId);
    return { ok: true };
  });
  app.post('/staff/feedback/:id/send', async (req) => {
    const c = await staffContext(req, ['doctor']);
    const b = z
      .object({ kind: z.enum(['initial', 'reminder']), approved: z.literal(true) })
      .parse(req.body);
    return dispatch(c.clinicId, id(req), b.kind);
  });
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      for (const c of (await deps.pool.query('SELECT id FROM clinics_for_sweeps()')).rows) {
        const enabled = await scoped(
          c.id,
          async (db) =>
            (await db.query('SELECT 1 FROM patient_feedback_settings WHERE enabled')).rowCount,
        );
        if (!enabled) continue;
        await refreshDelivery(c.id).catch(() => {});
        const due = await scoped(
          c.id,
          async (db) =>
            (
              await db.query(
                "SELECT c.id,c.reminder_enabled FROM patient_checkins c JOIN patient_feedback_settings s ON s.clinic_id=c.clinic_id AND s.enabled WHERE c.status='scheduled' AND c.work_status='planned' AND c.scheduled_at<=now() AND (NOT EXISTS(SELECT 1 FROM patient_feedback_delivery d WHERE d.checkin_id=c.id AND d.kind='initial' AND d.state<>'blocked') OR (c.reminder_enabled AND EXISTS(SELECT 1 FROM patient_feedback_delivery d WHERE d.checkin_id=c.id AND d.kind='initial' AND d.delivered_at<now()-interval '2 days') AND NOT EXISTS(SELECT 1 FROM patient_feedback_delivery d WHERE d.checkin_id=c.id AND d.kind='reminder' AND d.state<>'blocked'))) ORDER BY c.scheduled_at LIMIT 50",
              )
            ).rows,
        );
        if (!due.length) continue;
        for (const row of due) {
          await dispatch(c.id, row.id, 'initial');
          if (row.reminder_enabled) await dispatch(c.id, row.id, 'reminder');
        }
      }
    } catch {
      app.log.warn('Patient check-in delivery sweep needs review');
    } finally {
      running = false;
    }
  };
  let timer: NodeJS.Timeout | undefined;
  app.addHook('onReady', async () => {
    if (patientMessageJobsEnabled(process.env) && process.env.NODE_ENV !== 'test')
      timer = setInterval(() => void sweep(), 60000);
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
}
