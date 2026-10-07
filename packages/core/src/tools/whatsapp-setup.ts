import { z } from 'zod';
import { defineTool, ToolError } from './registry';
export const whatsappSetupTools = [
  defineTool({
    name: 'attach_verified_whatsapp_channel',
    description: 'Operator attaches an already authorized platform channel to its clinic',
    module: 'core',
    input: z.object({
      phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
      channelId: z.string().uuid(),
      appId: z.string().uuid(),
      phase: z.enum(['WEBHOOK_PENDING', 'READY', 'ACTIVE']),
    }),
    allow: ['system'],
    auditInput: () => ({ details: 'redacted' }),
    auditOutput: () => ({ saved: true }),
    async run({ db, ctx }, i) {
      const r = await db.query(
        `INSERT INTO clinic_whatsapp_setup(clinic_id,phone,state,channel_id,channel_app_id,preparation)
        VALUES($1,$2,'CONNECTED',$3,$4,$5) ON CONFLICT(clinic_id) DO UPDATE SET
        phone=EXCLUDED.phone,state='CONNECTED',channel_id=EXCLUDED.channel_id,channel_app_id=EXCLUDED.channel_app_id,preparation=EXCLUDED.preparation,updated_at=now()
        WHERE (clinic_whatsapp_setup.state='REQUESTED' AND clinic_whatsapp_setup.session_id IS NULL AND clinic_whatsapp_setup.channel_id IS NULL)
        OR (clinic_whatsapp_setup.state='CONNECTED' AND clinic_whatsapp_setup.channel_id=$3 AND clinic_whatsapp_setup.channel_app_id=$4 AND clinic_whatsapp_setup.phone=$2)
        RETURNING *`,
        [ctx.clinicId, i.phone, i.channelId, i.appId, i.phase],
      );
      if (!r.rowCount)
        throw new ToolError(
          'setup_conflict',
          'Existing clinic connection needs operator reconciliation.',
          409,
        );
      return r.rows[0];
    },
  }),

  defineTool({
    name: 'record_whatsapp_preparation',
    description: 'Save verified clinic channel preparation',
    module: 'core',
    input: z.object({
      channelId: z.string().uuid(),
      appId: z.string().uuid(),
      phase: z.enum(['PREPARING', 'WEBHOOK_PENDING', 'READY', 'ACTIVE']),
    }),
    allow: ['system'],
    auditInput: (i) => ({ phase: i.phase }),
    auditOutput: () => ({ saved: true }),
    async run({ db, ctx }, i) {
      const result = await db.query(
        `UPDATE clinic_whatsapp_setup SET channel_id=$2,channel_app_id=$3,preparation=$4,updated_at=now() WHERE clinic_id=$1 AND state='CONNECTED' AND (channel_id IS NULL OR channel_id=$2) AND (channel_app_id IS NULL OR channel_app_id=$3) RETURNING *`,
        [ctx.clinicId, i.channelId, i.appId, i.phase],
      );
      if (!result.rowCount)
        throw new ToolError(
          'setup_conflict',
          'Verified clinic connection changed. Ask your setup team to review.',
          409,
        );
      return result.rows[0];
    },
  }),

  defineTool({
    name: 'request_whatsapp_setup',
    description: 'Save clinic WhatsApp setup details',
    module: 'core',
    input: z.object({
      phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
      faq: z.string().max(12000).default(''),
    }),
    allow: ['staff:admin'],
    auditInput: () => ({ details: 'redacted' }),
    auditOutput: () => ({ saved: true }),
    async run({ db, ctx }, i) {
      const result = await db.query(
        `INSERT INTO clinic_whatsapp_setup(clinic_id,phone,faq) VALUES($1,$2,$3)
 ON CONFLICT(clinic_id) DO UPDATE SET phone=EXCLUDED.phone,faq=EXCLUDED.faq,updated_at=now()
 WHERE clinic_whatsapp_setup.state='REQUESTED' RETURNING *`,
        [ctx.clinicId, i.phone, i.faq],
      );
      if (!result.rowCount)
        throw new ToolError(
          'setup_in_progress',
          'Your setup team must finish or reconcile the existing connection before changing details.',
          409,
        );
      return result.rows[0];
    },
  }),
  defineTool({
    name: 'advance_whatsapp_setup',
    description: 'Record a platform onboarding transition',
    module: 'core',
    input: z.object({
      from: z.string(),
      to: z.enum([
        'STARTING',
        'CONNECTING',
        'OWNERSHIP_CHECK_REQUIRED',
        'CHECK_REQUIRED',
        'CONNECTED',
      ]),
      sessionId: z.string().uuid().optional(),
    }),
    allow: ['system'],
    auditInput: (i) => ({ from: i.from, to: i.to }),
    auditOutput: () => ({ saved: true }),
    async run({ db, ctx }, i) {
      const result = await db.query(
        `UPDATE clinic_whatsapp_setup SET state=$3,session_id=COALESCE($4,session_id),updated_at=now()
 WHERE clinic_id=$1 AND state=$2 RETURNING *`,
        [ctx.clinicId, i.from, i.to, i.sessionId ?? null],
      );
      if (!result.rowCount)
        throw new ToolError('setup_conflict', 'Setup changed. Refresh its saved status.', 409);
      return result.rows[0];
    },
  }),
];
