import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withClinic } from '@sahayak/db';
import { patientMessageJobsEnabled } from '@sahayak/shared';
import type { AppDeps } from './app';
import { whatsappPlatform } from './whatsapp-platform';

const result = z.object({
  id: z.string().uuid(),
  status: z.string(),
  delivery: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});
export async function dispatchScheduleNotice(deps: AppDeps, clinic: string, id: string) {
  const channel = Object.entries(deps.whatsappBridge ?? {}).find(
    ([, b]) => b.clinicId === clinic,
  )?.[0];
  if (!channel) return;
  return withClinic(deps.pool, clinic, async (db) => {
    const row = (
      await db.query(
        `SELECT d.*,p.phone,p.language,p.erasure_requested_at,c.state conversation_state,c.handled_by,i.new_start,i.needs_rebooking,a.starts_at,a.status appointment_status
      FROM schedule_message_delivery d JOIN patients p ON p.id=d.patient_id
      JOIN schedule_shift_items i ON i.id=d.item_id JOIN appointments a ON a.id=i.appointment_id
      LEFT JOIN conversations c ON c.patient_id=p.id AND c.channel='whatsapp'
      WHERE d.id=$1 FOR UPDATE OF d`,
        [id],
      )
    ).rows[0];
    if (!row || !['pending', 'blocked', 'draft'].includes(row.state)) return;
    const stop = async (detail: string, state = 'blocked') => {
      await db.query(
        'UPDATE schedule_message_delivery SET state=$2,detail=$3,updated_at=now() WHERE id=$1',
        [id, state, detail],
      );
      await db.query(
        "UPDATE schedule_shift_items SET response='no_consent' WHERE id=$1 AND NOT notified",
        [row.item_id],
      );
      if (!row.detail)
        await db.query(
          "INSERT INTO flags(clinic_id,patient_id,kind,severity,summary) VALUES($1,$2,'system','normal',$3)",
          [
            clinic,
            row.patient_id,
            'Appointment update was not delivered. Contact this patient: ' + detail,
          ],
        );
    };
    if (Date.now() - new Date(row.created_at).getTime() > 3600000)
      return stop('Update expired; contact the patient directly.', 'cancelled');
    if (
      !['booked', 'checked_in', 'needs_rebooking'].includes(row.appointment_status) ||
      (!row.needs_rebooking &&
        new Date(row.starts_at).getTime() !== new Date(row.new_start).getTime())
    )
      return stop(
        'The appointment changed again. Review its current time before contacting the patient.',
        'cancelled',
      );
    const consent = (
      await db.query(
        "SELECT 1 FROM consents WHERE patient_id=$1 AND purpose='whatsapp_messaging' AND withdrawn_at IS NULL",
        [row.patient_id],
      )
    ).rowCount;
    if (!consent || row.erasure_requested_at)
      return stop('Patient messaging permission is unavailable.', 'cancelled');
    const conversation = (
      await db.query(
        "SELECT state,handled_by FROM conversations WHERE patient_id=$1 AND channel='whatsapp' FOR UPDATE",
        [row.patient_id],
      )
    ).rows[0];
    if (
      conversation?.handled_by === 'human' ||
      (conversation?.state &&
        Object.keys(conversation?.state).length &&
        conversation?.state.itemId !== row.item_id)
    )
      return stop('A patient conversation is in progress. Staff follow-up is needed.');
    let approvalAttempted = false;
    try {
      const draft = await whatsappPlatform(
        deps.whatsappPlatform,
        clinic,
        `/v1/whatsapp/channels/${channel}/session-outbound`,
        result,
        { recipient: row.phone, text: row.body, idempotency_key: 'sahayak-delay-' + id },
      );
      await db.query(
        "UPDATE schedule_message_delivery SET channel_id=$2,provider_id=$3,state='draft' WHERE id=$1",
        [id, channel, draft.id],
      );
      approvalAttempted = true;
      const approved = await whatsappPlatform(
        deps.whatsappPlatform,
        clinic,
        `/v1/whatsapp/channels/${channel}/outbound/${draft.id}/approve`,
        result,
        { confirm: true, recipient_consented: true },
      );
      await db.query(
        'UPDATE schedule_message_delivery SET state=$2,detail=NULL,updated_at=now() WHERE id=$1',
        [id, approved.status.toLowerCase()],
      );
      await db.query("UPDATE schedule_shift_items SET response='pending' WHERE id=$1", [
        row.item_id,
      ]);
      // Establish the reply flow, but do not label the notice delivered before a receipt.
      const conv = (
        await db.query(
          `INSERT INTO conversations(clinic_id,patient_id,channel,contact,language,state)
        VALUES($1,$2,'whatsapp',$3,$4,$5) ON CONFLICT(clinic_id,channel,contact)
        DO UPDATE SET state=EXCLUDED.state,updated_at=now() RETURNING id`,
          [clinic, row.patient_id, row.phone, row.language, JSON.stringify(row.next_state)],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO messages(clinic_id,conversation_id,direction,sender,body) VALUES($1,$2,'out','agent:schedule',$3)",
        [clinic, conv.id, row.body],
      );
    } catch {
      await stop(
        approvalAttempted
          ? 'Sending outcome is uncertain. Check delivery before retrying.'
          : 'An active WhatsApp chat is required. Ask the patient to message the clinic, or contact them directly.',
        approvalAttempted ? 'unknown' : 'blocked',
      );
    }
  });
}

export async function refreshScheduleNotices(deps: AppDeps, clinic: string) {
  const channel = Object.entries(deps.whatsappBridge ?? {}).find(
    ([, b]) => b.clinicId === clinic,
  )?.[0];
  if (!channel) return;
  const rows = await whatsappPlatform(
    deps.whatsappPlatform,
    clinic,
    `/v1/whatsapp/channels/${channel}/outbound`,
    z.array(result.extend({ idempotency_key: z.string().optional() })),
  );
  await withClinic(deps.pool, clinic, async (db) => {
    for (const row of rows) {
      const state = row.delivery ?? row.status.toLowerCase();
      const delivered = ['delivered', 'read'].includes(state);
      const records = await db.query(
        `UPDATE schedule_message_delivery SET provider_id=COALESCE(provider_id,$1),channel_id=$2,
        state=CASE WHEN delivered_at IS NOT NULL THEN state ELSE $3 END,
        delivered_at=CASE WHEN $4 THEN COALESCE(delivered_at,now()) ELSE delivered_at END,updated_at=now()
        WHERE (provider_id=$1 OR (provider_id IS NULL AND $5='sahayak-delay-'||id::text)) RETURNING item_id,delivered_at`,
        [row.id, channel, state, delivered, row.idempotency_key ?? null],
      );
      for (const r of records.rows) {
        if (r.delivered_at)
          await db.query('UPDATE schedule_shift_items SET notified=true WHERE id=$1', [r.item_id]);
        else if (['failed', 'cancelled', 'unknown'].includes(state))
          await db.query("UPDATE schedule_shift_items SET response='no_consent' WHERE id=$1", [
            r.item_id,
          ]);
      }
    }
  });
}

export function installScheduleDelivery(app: FastifyInstance, deps: AppDeps) {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      for (const clinic of new Set(
        Object.values(deps.whatsappBridge ?? {}).map((b) => b.clinicId),
      )) {
        const ids = await withClinic(
          deps.pool,
          clinic,
          async (db) =>
            (
              await db.query(
                "SELECT id FROM schedule_message_delivery WHERE state IN ('pending','blocked','draft') ORDER BY created_at LIMIT 50",
              )
            ).rows,
        );
        for (const row of ids) await dispatchScheduleNotice(deps, clinic, row.id);
        await refreshScheduleNotices(deps, clinic).catch(() => {});
      }
    } catch {
      app.log.warn('Appointment message delivery needs review');
    } finally {
      running = false;
    }
  };
  let timer: NodeJS.Timeout | undefined;
  app.addHook('onReady', async () => {
    if (patientMessageJobsEnabled(process.env) && process.env.NODE_ENV !== 'test')
      timer = setInterval(() => void sweep(), 10000);
  });
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
  });
}
